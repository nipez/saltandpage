import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Search, Link as LinkIcon, X, Trash2, Edit3, Share2, Clock, Users, ChefHat, Loader2, Check, AlertCircle, BookOpen, ArrowLeft, Copy, Download, Scale, RotateCcw, Camera, ImageOff, Calendar, MessageSquarePlus, ShoppingBasket, History, Maximize2, Minimize2, ChevronLeft, ChevronRight, Refrigerator, Sparkles, Flame, CalendarDays, Replace, Printer, FolderOpen, Tag, Star, Timer, Pause, Play, ThumbsUp, ThumbsDown, Image as ImageIcon, Settings as SettingsIcon, Mic, MicOff, Activity, Square, CheckSquare, Wand2, Send, Smartphone, Info, ExternalLink } from 'lucide-react';
import { ANTHROPIC_MODEL, postAi } from './ai.js';

const DIET_TAGS = [
  'keto', 'low-carb', 'vegetarian', 'vegan', 'gluten-free',
  'paleo', 'whole30', 'dairy-free', 'mediterranean', 'high-protein'
];

const STORAGE_PREFIX = 'recipe:';

// ---------- Scaling helpers ----------
// Parses a leading quantity from an ingredient string.
// Handles: "2 cups", "1/2 tsp", "1 1/2 cups", "0.5 cup", and unicode fractions like "½".
const UNICODE_FRACS = { '½': 0.5, '⅓': 1/3, '⅔': 2/3, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

function parseQuantity(str) {
  if (!str) return { qty: null, rest: str || '' };
  // Replace unicode fractions with ascii equivalents
  let s = str.replace(/(\d+)([½⅓⅔¼¾⅛⅜⅝⅞])/g, (_, w, f) => `${w} ${UNICODE_FRACS[f]}`);
  s = s.replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/g, m => String(UNICODE_FRACS[m]));

  // Mixed: "1 1/2"
  const mixed = s.match(/^\s*(\d+)\s+(\d+)\/(\d+)\s*/);
  if (mixed) {
    const qty = parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
    return { qty, rest: s.slice(mixed[0].length) };
  }
  // Fraction: "1/2"
  const frac = s.match(/^\s*(\d+)\/(\d+)\s*/);
  if (frac) {
    return { qty: parseInt(frac[1]) / parseInt(frac[2]), rest: s.slice(frac[0].length) };
  }
  // Decimal or whole: "2" or "1.5"
  const num = s.match(/^\s*(\d+(?:\.\d+)?)\s*/);
  if (num) {
    return { qty: parseFloat(num[1]), rest: s.slice(num[0].length) };
  }
  return { qty: null, rest: str };
}

function formatQuantity(num) {
  if (num == null || isNaN(num)) return '';
  if (num === 0) return '0';
  // Round to 4 decimals to avoid floating-point drift
  num = Math.round(num * 10000) / 10000;

  const whole = Math.floor(num);
  const remainder = num - whole;

  // Common kitchen fractions, sorted by ascending value
  const fractions = [
    [1/8, '⅛'], [1/4, '¼'], [1/3, '⅓'], [3/8, '⅜'],
    [1/2, '½'], [5/8, '⅝'], [2/3, '⅔'], [3/4, '¾'], [7/8, '⅞']
  ];

  // Tolerance for "close enough" — within 1/32 of a fraction
  const TOL = 1 / 32;
  if (remainder < TOL) return String(whole);
  if (1 - remainder < TOL) return String(whole + 1);

  let best = null;
  let bestDiff = Infinity;
  for (const [val, str] of fractions) {
    const diff = Math.abs(remainder - val);
    if (diff < bestDiff) { bestDiff = diff; best = str; }
  }

  if (bestDiff < TOL) {
    return whole > 0 ? `${whole} ${best}` : best;
  }
  // Fall back to a clean decimal — trim trailing zeros
  return parseFloat(num.toFixed(2)).toString();
}

function scaleIngredient(line, factor) {
  const { qty, rest } = parseQuantity(line);
  if (qty == null) return line; // can't parse — leave alone (e.g. "a pinch of salt")
  const scaled = qty * factor;
  return `${formatQuantity(scaled)}${rest.startsWith(' ') ? '' : ' '}${rest}`.replace(/\s+/g, ' ').trim();
}

function scaleServings(serv, factor) {
  if (!serv) return serv;
  const match = String(serv).match(/(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)/);
  if (!match) return serv;
  const original = match[1];
  // If it's a range like "4-6", scale both ends
  if (original.includes('-')) {
    const [lo, hi] = original.split('-').map(s => parseFloat(s.trim()));
    return serv.replace(original, `${formatQuantity(lo * factor)}–${formatQuantity(hi * factor)}`);
  }
  const num = parseFloat(original);
  return serv.replace(original, formatQuantity(num * factor));
}

const SCALE_PRESETS = [
  { label: '½', value: 0.5 },
  { label: '⅔', value: 2/3 },
  { label: '1×', value: 1 },
  { label: '1½', value: 1.5 },
  { label: '2×', value: 2 },
  { label: '3×', value: 3 }
];

// ---------- Image helpers ----------
// Compresses an uploaded image to a data URL suitable for storage.
// Photos from phones can be 5+ MB raw — too big for our 5MB-per-key cap.
function compressImage(file, { maxWidth = 1400, quality = 0.78 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w);
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // flatten transparent PNGs onto white for jpeg
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function formatLogDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Strip query string and fragment from a URL for cleaner display
function cleanUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return String(url).split('?')[0].split('#')[0];
  }
}

// AI-rewrite recipe instructions for a new scale. Quantities in prose get adjusted;
// techniques and timing stay put. Steps may be plain strings or {text, duration_min} objects.
async function rewriteMethodForScale(instructions, scale) {
  // Send only text to the AI; preserve durations locally.
  const stepTexts = (instructions || []).map(s => getStepText(s));
  const durations = (instructions || []).map(s => getStepDuration(s));

  const prompt = `These recipe steps are written for the original recipe size. Rewrite them for a recipe scaled to ${scale}× the original.

Rules:
- Update any quantities, measurements, or counts mentioned (e.g. "2 cups of flour" → adjusted; "3 eggs" → adjusted).
- Keep the same number of steps in the same order.
- Don't change techniques, equipment, or cooking times — those don't scale linearly.
- Match the original tone and length. Don't add commentary.
- Use clean kitchen fractions (½, ¼, ⅓) over decimals.

Original steps:
${JSON.stringify(stepTexts, null, 2)}

Return ONLY a JSON array of strings (one per step). No markdown, no preamble.`;

  const data = await postAi({
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrMatch) throw new Error('Could not parse rewritten steps');
  const parsed = JSON.parse(arrMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('Unexpected response shape');
  // Reattach original duration_min where present
  return parsed.map((t, i) => durations[i] ? { text: t, duration_min: durations[i] } : t);
}

// AI-consolidate ingredients across recipes into a single shopping list.
// Combines compatible quantities, lists incompatible measurements separately,
// and groups by aisle category.
async function consolidateShoppingList(recipeEntries) {
  const recipesText = recipeEntries.map((r, i) =>
    `${i + 1}. "${r.title}" (scaled ${formatQuantity(r.scale)}×):\n${r.ingredients.map(ing => `   - ${ing}`).join('\n')}`
  ).join('\n\n');

  const prompt = `Consolidate the ingredients from these recipes into a single shopping list. The quantities have ALREADY been scaled — use them as-is, don't re-scale.

${recipesText}

Rules:
- Combine same ingredient when units are compatible (e.g., "1 cup flour" + "2 cups flour" = "3 cups flour").
- If units differ but the ingredient is the same (e.g., "8 oz butter" + "1 stick butter"), list separately or convert if obvious — be conservative, don't guess wildly.
- Keep distinctly different ingredients separate (e.g., "fresh basil" vs "dried basil").
- Strip parenthetical prep notes from the name ("garlic, minced" → name "garlic", prep "minced").
- Use clean kitchen fractions (½, ¼, ⅓) over decimals.
- Track which recipes each item came from.
- Categorize each item into ONE of: produce, meat-seafood, dairy, pantry, baking, spices, frozen, bakery, beverages, other

Return ONLY a JSON object (no markdown, no preamble):
{
  "items": [
    {
      "name": "ingredient name (e.g. 'all-purpose flour')",
      "amount": "consolidated quantity (e.g. '3 ½ cups')",
      "prep": "prep note or null (e.g. 'minced', 'softened')",
      "category": "produce | meat-seafood | dairy | pantry | baking | spices | frozen | bakery | beverages | other",
      "sources": ["Recipe Title", ...]
    }
  ]
}`;

  const data = await postAi({
    model: ANTHROPIC_MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse list');
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.items)) throw new Error('Unexpected response shape');
  // Stamp each item with an id for check-state tracking
  return parsed.items.map((it, i) => ({
    ...it,
    id: `item_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
    checked: false
  }));
}

// Extract a recipe from an image (cookbook page, recipe card, handwritten note).
// Uses AI vision — passes the image as base64 to the API.
async function extractRecipeFromPhoto(dataUrl) {
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.*)$/);
  if (!m) throw new Error('Invalid image data');
  const mediaType = m[1];
  const base64 = m[2];

  const data = await postAi({
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64 }
        },
        {
          type: 'text',
          text: `Extract the recipe from this image. It might be a cookbook page, a printed recipe card, a handwritten note, a photo of a magazine, or similar.

Return ONLY a JSON object (no markdown, no code fences, no preamble):
{
  "title": "string",
  "ingredients": ["string", "..."],
  "instructions": ["string OR {\"text\": string, \"duration_min\": number}"],
  "prep_time": "string or null",
  "cook_time": "string or null",
  "servings": "string or null",
  "diet_tags": ["string"],
  "notes": "string or null — any tips, attributions, or asides on the page"
}

Rules:
- ingredients: each string is one full ingredient line. Don't nest.
- ingredient SECTIONS: if the recipe groups ingredients (e.g. "For the dough:", "Filling:"), include those as separate string entries between the items they group. Example: ["For the crust:", "2 cups flour", "...", "For the filling:", "..."]
- instructions: each step is ONE entry. Use a plain string by default. ONLY use the {text, duration_min} form when the step EXPLICITLY states a NUMBER of minutes/hours (e.g. "simmer 20 minutes" → duration_min: 20, "bake for 15-18 min" → duration_min: 17). Do NOT estimate. "Cook until fragrant" or "drain the fat" or "season to taste" stay as plain strings — no number means no object form.
- diet_tags: only from this list, only if clearly applicable: ${DIET_TAGS.join(', ')}
- If handwriting is hard to read, do your best and use "[unclear]" for words you can't make out.
- If the image isn't a recipe at all, return: {"error": "reason"}`
        }
      ]
    }]
  });
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse recipe from image');
  const parsed = JSON.parse(jsonMatch[0]);
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

// ---------- Substitutions library ----------
// A curated collection of near-universal kitchen substitutions. Used as the first
// lookup before falling back to the AI. Only ingredients where the swap is
// context-independent enough to apply across most recipes belong here — flour,
// sugar, eggs (beyond binders), and anything where role varies dramatically by
// recipe still go through the AI for proper context.
const SUB_LIBRARY = {
  // Dairy
  'buttermilk': [
    { swap: 'milk + lemon juice or vinegar', ratio: '1 cup milk + 1 tbsp acid = 1 cup buttermilk', notes: 'Stir and let stand 5 minutes until slightly curdled.' },
    { swap: 'plain yogurt', ratio: '1:1, thin with milk if needed', notes: 'Greek yogurt thinned with a splash of milk works equally well.' },
    { swap: 'kefir', ratio: '1:1', notes: 'Same tang and texture; the closest match.' }
  ],
  'sour cream': [
    { swap: 'plain Greek yogurt', ratio: '1:1', notes: 'Best general substitute. Slightly tangier — fine for most uses.' },
    { swap: 'crème fraîche', ratio: '1:1', notes: 'Richer, less tangy. Holds up better when heated.' },
    { swap: 'cottage cheese (blended)', ratio: '1:1', notes: 'Blend until completely smooth first.' }
  ],
  'heavy cream': [
    { swap: 'whole milk + butter', ratio: '3/4 cup whole milk + 1/4 cup melted butter = 1 cup', notes: 'For cooking only — won\'t whip into peaks.' },
    { swap: 'evaporated milk', ratio: '1:1', notes: 'For cooking, not whipping. Slightly sweeter.' },
    { swap: 'coconut cream (full-fat)', ratio: '1:1', notes: 'Dairy-free. Adds subtle coconut flavor; whips when chilled.' }
  ],
  'heavy whipping cream': [
    { swap: 'whole milk + butter', ratio: '3/4 cup whole milk + 1/4 cup melted butter = 1 cup', notes: 'For cooking only — won\'t whip.' },
    { swap: 'coconut cream (chilled)', ratio: '1:1', notes: 'Dairy-free and whips beautifully when cold.' }
  ],
  'half and half': [
    { swap: 'whole milk + cream', ratio: '3/4 cup milk + 1/4 cup heavy cream = 1 cup', notes: 'Exact match.' },
    { swap: 'evaporated milk', ratio: '1:1', notes: 'Slightly thicker, slightly sweeter.' }
  ],
  'half-and-half': [
    { swap: 'whole milk + cream', ratio: '3/4 cup milk + 1/4 cup heavy cream = 1 cup', notes: 'Exact match.' },
    { swap: 'evaporated milk', ratio: '1:1', notes: 'Slightly thicker, slightly sweeter.' }
  ],
  'whole milk': [
    { swap: '2% milk + cream', ratio: '7/8 cup 2% milk + 1/8 cup heavy cream = 1 cup whole milk', notes: 'Restores the fat content.' },
    { swap: 'evaporated milk diluted', ratio: '1/2 cup evaporated + 1/2 cup water = 1 cup whole milk', notes: 'Slightly sweeter.' },
    { swap: 'unsweetened oat milk', ratio: '1:1', notes: 'Best dairy-free option for baking — closest fat profile.' }
  ],
  'cream cheese': [
    { swap: 'mascarpone', ratio: '1:1', notes: 'Richer, less tangy. Excellent in cheesecakes and frostings.' },
    { swap: 'ricotta + heavy cream', ratio: '3/4 cup ricotta + 1/4 cup cream, blended', notes: 'Drain ricotta first if watery.' },
    { swap: 'thick Greek yogurt', ratio: '1:1, strained overnight', notes: 'Tangier; works for spreads, not baked goods.' }
  ],
  'ricotta': [
    { swap: 'cottage cheese (drained)', ratio: '1:1', notes: 'Drain in a sieve 10 min. Blend if you want it smoother.' },
    { swap: 'cream cheese (softened)', ratio: '1:1', notes: 'Richer and tangier; works well in lasagna and stuffed pastas.' }
  ],
  'evaporated milk': [
    { swap: 'whole milk reduced', ratio: '2 1/2 cups whole milk simmered down to 1 cup', notes: 'Reduce gently, stirring, until thickened.' },
    { swap: 'half-and-half', ratio: '1:1', notes: 'Closest in body and richness.' }
  ],
  'crème fraîche': [
    { swap: 'sour cream', ratio: '1:1', notes: 'Tangier; whisk in a splash of cream to soften.' },
    { swap: 'heavy cream + buttermilk', ratio: '1 cup cream + 2 tbsp buttermilk, left at room temp 12-24h', notes: 'Real homemade version; needs time.' }
  ],

  // Acids
  'lemon juice': [
    { swap: 'lime juice', ratio: '1:1', notes: 'Slightly more floral; equivalent acidity.' },
    { swap: 'white vinegar', ratio: '1/2 the amount', notes: 'Sharper. Use less and adjust to taste.' },
    { swap: 'apple cider vinegar', ratio: '3/4 the amount', notes: 'Adds a gentle fruitiness.' }
  ],
  'lime juice': [
    { swap: 'lemon juice', ratio: '1:1', notes: 'Same acidity, slightly different aroma.' }
  ],
  'white wine': [
    { swap: 'chicken or vegetable broth + lemon', ratio: '1 cup broth + 1 tbsp lemon juice', notes: 'For cooking. Adds savory depth.' },
    { swap: 'white grape juice + vinegar', ratio: '1 cup juice + 1 tbsp white vinegar', notes: 'For sweeter or more delicate dishes.' }
  ],
  'red wine': [
    { swap: 'beef broth + balsamic', ratio: '1 cup broth + 1 tbsp balsamic vinegar', notes: 'For braises and pan sauces.' },
    { swap: 'grape juice + vinegar', ratio: '1 cup juice + 1 tbsp red wine vinegar', notes: 'For sweeter applications.' }
  ],
  'balsamic vinegar': [
    { swap: 'red wine vinegar + sugar', ratio: '1 tbsp vinegar + 1/2 tsp sugar = 1 tbsp balsamic', notes: 'Closest substitute. Adjust sugar to taste.' },
    { swap: 'apple cider vinegar + molasses', ratio: '1 tbsp ACV + 1/2 tsp molasses = 1 tbsp balsamic', notes: 'Better for richer dishes.' }
  ],

  // Sweeteners
  'brown sugar': [
    { swap: 'white sugar + molasses', ratio: '1 cup white sugar + 1 tbsp molasses = 1 cup brown sugar', notes: 'Use 2 tbsp molasses for dark brown sugar.' },
    { swap: 'coconut sugar', ratio: '1:1', notes: 'Slightly less sweet; deeper caramel notes.' },
    { swap: 'maple sugar', ratio: '1:1', notes: 'Pricier but excellent flavor.' }
  ],
  'powdered sugar': [
    { swap: 'granulated sugar (blended)', ratio: '1 cup sugar + 1 tbsp cornstarch, blended fine', notes: 'Process in a clean blender until powdery.' }
  ],
  'confectioners sugar': [
    { swap: 'granulated sugar (blended)', ratio: '1 cup sugar + 1 tbsp cornstarch, blended fine', notes: 'Process in a clean blender until powdery.' }
  ],
  'honey': [
    { swap: 'maple syrup', ratio: '1:1', notes: 'Less floral, more woody. Excellent in baking.' },
    { swap: 'agave nectar', ratio: '2/3 the amount', notes: 'Sweeter and thinner; reduce slightly.' },
    { swap: 'brown rice syrup', ratio: '1:1', notes: 'Less sweet; vegan-friendly.' }
  ],
  'maple syrup': [
    { swap: 'honey', ratio: '1:1', notes: 'Slightly different flavor profile but works almost everywhere.' },
    { swap: 'brown sugar + water', ratio: '3/4 cup brown sugar + 1/4 cup water, simmered', notes: 'Closest pantry-staple match.' }
  ],
  'corn syrup': [
    { swap: 'simple syrup', ratio: '1 cup sugar + 1/4 cup water, simmered until dissolved', notes: 'Works for most baking applications.' },
    { swap: 'honey', ratio: '1:1', notes: 'Adds flavor; affects browning in baking.' }
  ],

  // Fats
  'butter (baking)': [
    { swap: 'coconut oil', ratio: '1:1', notes: 'Use refined for neutral flavor. Solid at room temp like butter.' },
    { swap: 'unsalted butter + 1/4 tsp salt', ratio: '1:1', notes: 'If your recipe calls for salted butter and you only have unsalted.' },
    { swap: 'vegan butter sticks', ratio: '1:1', notes: 'Earth Balance, Miyoko\'s, etc. Behave very similarly.' }
  ],
  'shortening': [
    { swap: 'butter', ratio: '1:1', notes: 'Slightly different texture in cookies — flatter, crisper.' },
    { swap: 'coconut oil (refined)', ratio: '1:1', notes: 'Same solid-at-room-temp behavior.' },
    { swap: 'lard', ratio: '1:1', notes: 'Old-school option; great for pie crusts.' }
  ],

  // Eggs (only the universal binder case — leavening eggs go to AI)
  'egg': [
    { swap: 'flax egg', ratio: '1 tbsp ground flax + 3 tbsp water = 1 egg', notes: 'Stir, let sit 5 min until gel-like. Best for binding in baking.' },
    { swap: 'chia egg', ratio: '1 tbsp chia seeds + 3 tbsp water = 1 egg', notes: 'Same prep as flax. Slightly grittier texture.' },
    { swap: 'unsweetened applesauce', ratio: '1/4 cup = 1 egg', notes: 'For moist quick breads and muffins. Won\'t bind as well as flax.' }
  ],

  // Pantry / sauces
  'soy sauce': [
    { swap: 'tamari', ratio: '1:1', notes: 'Gluten-free, slightly less salty.' },
    { swap: 'coconut aminos', ratio: '1:1, add a pinch of salt', notes: 'Sweeter, lower sodium. Adjust seasoning.' },
    { swap: 'liquid aminos', ratio: '1:1', notes: 'Bragg\'s. Same umami profile.' }
  ],
  'mirin': [
    { swap: 'rice vinegar + sugar', ratio: '1 tbsp rice vinegar + 1 tsp sugar = 1 tbsp mirin', notes: 'Closest pantry sub.' },
    { swap: 'dry sherry + sugar', ratio: '1 tbsp sherry + 1/2 tsp sugar = 1 tbsp mirin', notes: 'Adds a different depth.' }
  ],
  'self-rising flour': [
    { swap: 'all-purpose flour + leaveners', ratio: '1 cup AP + 1 1/2 tsp baking powder + 1/4 tsp salt = 1 cup self-rising', notes: 'Whisk dry ingredients before adding to recipe.' }
  ],
  'self rising flour': [
    { swap: 'all-purpose flour + leaveners', ratio: '1 cup AP + 1 1/2 tsp baking powder + 1/4 tsp salt = 1 cup self-rising', notes: 'Whisk dry ingredients before adding to recipe.' }
  ],
  'baking powder': [
    { swap: 'baking soda + cream of tartar', ratio: '1/4 tsp baking soda + 1/2 tsp cream of tartar = 1 tsp baking powder', notes: 'Use immediately — doesn\'t store well.' }
  ],
  'fresh ginger': [
    { swap: 'ground ginger', ratio: '1 tsp ground = 1 tbsp fresh, grated', notes: 'Loses brightness; better in baked goods than savory dishes.' },
    { swap: 'crystallized ginger (rinsed)', ratio: '1 tbsp finely chopped = 1 tbsp fresh, grated', notes: 'Rinse off the sugar first.' }
  ],
  'garlic clove': [
    { swap: 'garlic powder', ratio: '1/4 tsp powder = 1 medium clove', notes: 'Distributes more evenly; lacks the punch of fresh.' },
    { swap: 'jarred minced garlic', ratio: '1/2 tsp = 1 medium clove', notes: 'Convenient; flavor is milder and slightly funkier.' }
  ],
  'garlic cloves': [
    { swap: 'garlic powder', ratio: '1/4 tsp powder = 1 medium clove', notes: 'Distributes more evenly; lacks the punch of fresh.' },
    { swap: 'jarred minced garlic', ratio: '1/2 tsp = 1 medium clove', notes: 'Convenient; flavor is milder and slightly funkier.' }
  ]
};

// Match an ingredient line to a library key. Case-insensitive, word-boundary,
// longest-match-first so "olive oil" wins over "oil" if both were keys.
function findSubsInLibrary(ingredient) {
  if (!ingredient) return null;
  const text = String(ingredient).toLowerCase();
  const keys = Object.keys(SUB_LIBRARY).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i');
    if (re.test(text)) {
      return { key, subs: SUB_LIBRARY[key] };
    }
  }
  return null;
}

// Find user-saved substitutions that match the ingredient text. Returns an
// array of matching user subs (a user can save multiple swaps for the same
// ingredient — e.g., two preferred buttermilk subs). Same matching rules as
// the library: case-insensitive, word-boundary.
function findUserSubs(userSubItems, ingredient) {
  if (!ingredient || !Array.isArray(userSubItems) || userSubItems.length === 0) return [];
  const text = String(ingredient).toLowerCase();
  return userSubItems.filter(item => {
    const key = (item.ingredient || '').toLowerCase().trim();
    if (!key) return false;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i');
    return re.test(text);
  });
}

// Suggest 2-3 substitutions for a specific ingredient, given the recipe context.
async function getSubstitutions(ingredient, recipe) {
  const prompt = `For the recipe "${recipe.title}", I'm out of: ${ingredient}

Suggest 2-3 substitutions that work in THIS recipe specifically. Consider what role the ingredient plays here (binding, leavening, fat, acid, flavor, texture).

Return ONLY a JSON array (no markdown, no preamble):
[
  {
    "swap": "what to use instead",
    "ratio": "amount conversion (e.g. '1:1', 'use ¾ the amount', '1 tbsp + 1 tsp lemon juice')",
    "notes": "brief note on flavor or texture difference, or any caveats — keep under 20 words"
  }
]`;

  const data = await postAi({
    model: ANTHROPIC_MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrMatch) throw new Error('Could not parse substitutions');
  const parsed = JSON.parse(arrMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('Unexpected response shape');
  return parsed;
}

// ---------- Ingredient info library ----------
// Curated editorial entries for the most common ingredients. Hits return
// instantly with no API call. The AI fallback (getIngredientInfo) handles
// everything else. Tone: warm expert, never preachy.
const INGREDIENT_INFO = {
  'garlic': {
    about: 'A bulb in the allium family, cultivated for over 5,000 years and originally from Central Asia. Different prep methods yield wildly different flavors — raw is sharp and pungent, roasted is sweet and mellow.',
    storage: 'Cool, dry, ventilated. Don\'t refrigerate whole bulbs — encourages sprouting. Once peeled, refrigerate sealed for up to a week.',
    cooking: 'Mince and let sit 10 minutes before cooking — releases the most allicin. Burns easily; add to oil over medium-low heat. The longer it cooks, the milder and sweeter it gets.',
    pairs: ['olive oil', 'butter', 'basil', 'lemon', 'anchovy', 'tomato', 'rosemary'],
    wikipedia: 'https://en.wikipedia.org/wiki/Garlic'
  },
  'onion': {
    about: 'Another allium; the yellow onion is the kitchen workhorse worldwide. Sweet onions (Vidalia, Walla Walla) have lower sulfur and shine raw; red onions add color and bite to salads.',
    storage: 'Cool, dry, dark place — never refrigerate whole. Once cut, refrigerate sealed for up to a week.',
    cooking: 'Caramelize slowly — 30+ minutes, low heat — for deep sweetness. Sweat in fat for 5-7 minutes until translucent for soups and stews. Slice raw against the grain to soften the bite.',
    pairs: ['butter', 'thyme', 'beef', 'cheese', 'apple', 'wine', 'bay leaf'],
    wikipedia: 'https://en.wikipedia.org/wiki/Onion'
  },
  'olive oil': {
    about: 'Pressed juice from olives, ranging from extra-virgin (cold-pressed, fruit-forward, peppery finish) to refined (neutral, higher smoke point). Quality varies wildly — single-estate from a recent harvest is worth seeking out.',
    storage: 'Cool, dark place. Light and heat oxidize it quickly. Don\'t store next to the stove. Use within 6 months of opening for peak flavor.',
    cooking: 'Smoke point ~375°F for extra-virgin. Use cheap olive oil for cooking; save the good stuff for finishing dishes raw — drizzled on bread, tomatoes, or off heat.',
    pairs: ['lemon', 'garlic', 'herbs', 'bread', 'tomato', 'salt', 'almonds'],
    wikipedia: 'https://en.wikipedia.org/wiki/Olive_oil'
  },
  'butter': {
    about: 'Churned cream — about 80% fat, the rest water and milk solids. European-style butter has higher fat (82-85%); American is lower. Browned butter (beurre noisette) adds nutty depth to almost anything.',
    storage: 'Refrigerate up to a month. Freeze up to 6 months. Cultured butter is more flavorful but has a shorter shelf life.',
    cooking: 'Burns at lower temp than oil (~300°F). Combine with oil to raise the smoke point. Brown over medium heat until milk solids turn amber, then pour off heat to stop the cooking.',
    pairs: ['flour', 'eggs', 'cream', 'lemon', 'sage', 'shallot', 'vanilla'],
    wikipedia: 'https://en.wikipedia.org/wiki/Butter'
  },
  'eggs': {
    about: 'A nearly perfect food — proteins, fats, vitamins, and minerals in one shell. Older eggs peel easier when boiled (the air pocket grows). Orange yolks come from carotenoids in the hens\' diet.',
    storage: 'Refrigerate, pointed end down (keeps the yolk centered). Last 3-5 weeks past pack date. Float test: bad eggs float, fresh eggs sink.',
    cooking: 'Take to room temperature before baking — emulsifies better. Whip whites in a clean, dry bowl (any fat prevents peaks). For perfect scrambled, low and slow with butter and constant stirring.',
    pairs: ['butter', 'cheese', 'herbs', 'salt', 'cream', 'mushroom', 'bacon'],
    wikipedia: 'https://en.wikipedia.org/wiki/Egg_as_food'
  },
  'lemon': {
    about: 'Citrus fruit native to Asia, brought to the Mediterranean in the Middle Ages. The zest holds the most aromatic oils; the juice is the acid. Meyer lemons are sweeter and rounder — a cross with a mandarin.',
    storage: 'Counter for a few days; refrigerate for 3-4 weeks. Roll firmly on the counter before juicing — yields more juice. Always zest before juicing.',
    cooking: 'A finishing acid — adds brightness at the end. Don\'t boil with dairy (curdles). Preserved lemons (salt-cured) add umami depth to North African dishes.',
    pairs: ['olive oil', 'garlic', 'herbs', 'fish', 'chicken', 'sugar', 'butter'],
    wikipedia: 'https://en.wikipedia.org/wiki/Lemon'
  },
  'kosher salt': {
    about: 'Coarse-grained salt with no additives, originally used in koshering meat. Diamond Crystal and Morton are the two big brands and they have very different volumes per teaspoon — Diamond Crystal is half as salty by volume.',
    storage: 'Cool, dry place. Lasts indefinitely.',
    cooking: 'Salt in layers — at each stage of cooking, not just the end. The coarse grain makes it easier to pinch and feel. Always taste before adding more.',
    pairs: ['everything'],
    wikipedia: 'https://en.wikipedia.org/wiki/Kosher_salt'
  },
  'salt': {
    about: 'The first seasoning. Table salt has anti-caking agents and iodine; kosher and sea salt are pure NaCl with different crystal structures. Flaky finishing salts (Maldon) add texture, not just seasoning.',
    storage: 'Cool, dry place. Lasts indefinitely.',
    cooking: 'Season in layers, not just at the end. Different salts have wildly different volumes — by weight is the only consistent way. About 1.5% salt by weight in finished dishes is a starting baseline.',
    pairs: ['everything'],
    wikipedia: 'https://en.wikipedia.org/wiki/Salt'
  },
  'black pepper': {
    about: 'Dried, unripe berry of the Piper nigrum vine, native to South India. Pre-ground loses its punch within minutes — the volatile oils that give pepper its bite are fragile.',
    storage: 'Whole peppercorns last years; ground pepper loses potency in weeks. Buy whole, grind fresh.',
    cooking: 'Add toward the end of cooking — heat dulls the aromatic compounds. For steaks, crack rather than grind for texture. Bloom briefly in oil for sauces.',
    pairs: ['salt', 'butter', 'olive oil', 'cheese', 'beef', 'lemon', 'cream'],
    wikipedia: 'https://en.wikipedia.org/wiki/Black_pepper'
  },
  'soy sauce': {
    about: 'Fermented soybean and wheat. Chinese and Japanese versions differ meaningfully — light soy is saltier and brighter (everyday cooking); dark soy is thicker and sweeter (color and depth in braises). Tamari is wheat-free.',
    storage: 'Refrigerate after opening for best flavor; lasts 1-2 years. Color darkens over time.',
    cooking: 'A primary umami source. Reduce gently to concentrate; don\'t boil hard. A splash at the end of a sauce or stir-fry rounds out flavors better than salt alone.',
    pairs: ['ginger', 'garlic', 'sesame oil', 'rice', 'mushroom', 'scallion', 'sugar'],
    wikipedia: 'https://en.wikipedia.org/wiki/Soy_sauce'
  },
  'ginger': {
    about: 'A rhizome (underground stem) of the Zingiber plant, native to Southeast Asia. Young ginger is mild and tender; older roots are spicier and more fibrous. The skin is edible — just scrape with a spoon.',
    storage: 'Counter for a week, refrigerator for 3 weeks, freezer indefinitely. Frozen ginger grates easily directly from frozen.',
    cooking: 'Grate on a microplane for maximum surface area. Add early to oil for warming flavor; add at the end raw or grated for sharp brightness.',
    pairs: ['garlic', 'soy sauce', 'sesame oil', 'lime', 'honey', 'scallion', 'chili'],
    wikipedia: 'https://en.wikipedia.org/wiki/Ginger'
  },
  'parmesan': {
    about: 'Parmigiano-Reggiano (the real thing) is a hard cow\'s-milk cheese aged 12-36 months in a small region of northern Italy. Domestic "parmesan" is something else entirely — usually younger, drier, less complex. The rind is gold for soups and risottos.',
    storage: 'Wrap in parchment then plastic. Refrigerate up to a month. Freezes well — grate directly from frozen.',
    cooking: 'Add toward the end so it doesn\'t turn stringy. Save rinds for soup or risotto — they melt down into pure umami. Microplane for the finest grate; box grater for melting.',
    pairs: ['pasta', 'butter', 'black pepper', 'tomato', 'risotto', 'arugula', 'eggs'],
    wikipedia: 'https://en.wikipedia.org/wiki/Parmigiano-Reggiano'
  },
  'tomatoes': {
    about: 'Botanically a fruit, culinarily a vegetable. Native to South America, Italianized after the 16th century. Heirloom varieties are about flavor; commercial reds are bred for shipping. Canned San Marzanos are often better than mediocre fresh ones.',
    storage: 'Never refrigerate fresh — destroys the flavor and texture. Counter, stem-side down. Once cut, refrigerate.',
    cooking: 'Salt sliced tomatoes 30 minutes ahead — draws out water, intensifies flavor. Roast or confit halves for sweetness. Score and blanch to peel.',
    pairs: ['basil', 'olive oil', 'garlic', 'mozzarella', 'anchovy', 'salt', 'red wine'],
    wikipedia: 'https://en.wikipedia.org/wiki/Tomato'
  },
  'basil': {
    about: 'A tender summer herb in the mint family, with dozens of varieties. Genovese is the classic Italian; Thai basil is anise-y and stands up to heat; holy basil is peppery and sacred in Hindu tradition.',
    storage: 'Never refrigerate fresh basil — turns black. Stand stems in water on the counter, like flowers. Use within 3-4 days.',
    cooking: 'Add at the very end — heat kills the flavor instantly. Tear by hand instead of cutting (oxidizes less). Make pesto when you have a glut.',
    pairs: ['tomato', 'mozzarella', 'olive oil', 'garlic', 'pine nut', 'lemon', 'pasta'],
    wikipedia: 'https://en.wikipedia.org/wiki/Basil'
  },
  'rice': {
    about: 'Domesticated in China around 9,000 years ago; staple for half the world. Long-grain (basmati, jasmine) stays separate; short-grain (sushi, arborio) gets sticky; medium-grain is in between. Brown rice is the whole grain — chewier, longer cook.',
    storage: 'Pantry up to a year. Cooked rice refrigerates 4-5 days. Reheat with a splash of water for steam.',
    cooking: 'Rinse white rice until water runs clear — removes excess starch. 1:1.5 rice-to-water for jasmine; 1:2 for basmati. Rest 10 minutes after cooking. Don\'t lift the lid.',
    pairs: ['butter', 'soy sauce', 'eggs', 'broth', 'beans', 'vegetables', 'chicken'],
    wikipedia: 'https://en.wikipedia.org/wiki/Rice'
  },
  'pasta': {
    about: 'Wheat flour and water (sometimes egg) — simple ingredient, infinite shapes. Each shape is designed for a sauce: long noodles for olive oil, short tubes for chunky ragùs, ridged shapes for clinging.',
    storage: 'Dry pasta lasts years. Fresh pasta refrigerates 2-3 days, freezes for months — boil from frozen.',
    cooking: 'Salt the water like the sea (1 tbsp per quart). Save a cup of starchy pasta water before draining — emulsifies the sauce. Finish cooking the pasta in the sauce, not separately.',
    pairs: ['olive oil', 'parmesan', 'butter', 'tomato', 'cream', 'garlic', 'pepper'],
    wikipedia: 'https://en.wikipedia.org/wiki/Pasta'
  },
  'mushrooms': {
    about: 'Fungi, not plants. Cremini and white button are the same species at different ages; portobello is just a giant cremini. Wild varieties (chanterelle, morel, porcini) have radically different flavors. Most flavor develops with browning.',
    storage: 'Refrigerate in a paper bag (not plastic — traps moisture). Use within a week. Don\'t wash until ready to use; wipe with a damp cloth.',
    cooking: 'Don\'t crowd the pan — they release water and steam instead of brown. High heat, dry pan, single layer, leave them alone for 4-5 minutes before stirring. Salt last (also draws out water).',
    pairs: ['butter', 'garlic', 'thyme', 'cream', 'wine', 'parsley', 'beef'],
    wikipedia: 'https://en.wikipedia.org/wiki/Mushroom'
  },
  'buttermilk': {
    about: 'Originally the liquid left over from churning butter. Today\'s commercial buttermilk is cultured — milk soured intentionally with bacteria. The acidity is what does the work in baking and marinades.',
    storage: 'Refrigerate. Lasts 1-2 weeks past sell-by date thanks to the acidity. Freezes well in ice cube trays for small uses.',
    cooking: 'Activates baking soda for lift. Tenderizes meat in marinades — break down proteins overnight. Don\'t boil — it curdles instantly.',
    pairs: ['baking soda', 'flour', 'fried chicken', 'biscuits', 'pancakes', 'ranch', 'blue cheese'],
    wikipedia: 'https://en.wikipedia.org/wiki/Buttermilk'
  },
  'heavy cream': {
    about: 'Milk\'s fat-rich top layer — at least 36% milkfat in the US. "Whipping cream" is slightly less (30-35%); "double cream" (UK) is more (48%). The fat is what lets it whip and what keeps it from curdling when reduced.',
    storage: 'Refrigerate. Lasts 1-2 weeks past sell-by. Freezes for cooking but not whipping.',
    cooking: 'Whips faster when chilled — bowl, beaters, cream all cold. Reduces beautifully without breaking, unlike milk. A splash at the end of a pan sauce smooths everything out.',
    pairs: ['butter', 'eggs', 'vanilla', 'pasta', 'mushroom', 'fruit', 'wine'],
    wikipedia: 'https://en.wikipedia.org/wiki/Cream'
  },
  'balsamic vinegar': {
    about: 'Traditional balsamic from Modena, Italy is aged grape must — sometimes for 25+ years — and costs hundreds of dollars per bottle. Most "balsamic" you buy is wine vinegar with caramel and thickener. Aged balsamic carries IGP or DOP designation.',
    storage: 'Cool, dark place. Lasts indefinitely — actually improves over time.',
    cooking: 'Don\'t cook the good stuff — it\'s a finishing condiment. Reduce cheap balsamic in a pan to make a glaze. A few drops on strawberries, vanilla ice cream, or aged parmesan is transcendent.',
    pairs: ['olive oil', 'parmesan', 'tomato', 'strawberry', 'arugula', 'fig', 'mozzarella'],
    wikipedia: 'https://en.wikipedia.org/wiki/Balsamic_vinegar'
  }
};

// Match an ingredient line to the info library. Same logic as findSubsInLibrary —
// case-insensitive, word-boundary, longest-match-first.
function findIngredientInfo(ingredient) {
  if (!ingredient) return null;
  const text = String(ingredient).toLowerCase();
  const keys = Object.keys(INGREDIENT_INFO).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i');
    if (re.test(text)) {
      return { key, info: INGREDIENT_INFO[key] };
    }
  }
  return null;
}

// AI fallback for ingredients not in the curated library. Returns the same
// shape as the library entries so the UI can render either source uniformly.
async function getIngredientInfo(ingredient) {
  const systemPrompt = `You are an editorial food writer for Salt & Page, a cookbook app. Given an ingredient, write concise, useful information for a home cook. Tone: warm, expert, never preachy. Like a knowledgeable cook talking to a friend. No fluff. No "you should..." Just useful information.`;

  const userPrompt = `Ingredient: ${ingredient}

Return ONLY a JSON object (no markdown, no preamble) with this exact shape:
{
  "about": "2-3 sentences. Origin, brief history, what it actually is, interesting trivia.",
  "storage": "1-2 sentences. How to keep it fresh, common mistakes.",
  "cooking": "2-3 sentences. How it behaves, classic uses, technique tips.",
  "pairs": ["array", "of", "5-7", "flavor", "companions"],
  "wikipedia": "https://en.wikipedia.org/wiki/Suitable_Page_Name (best-guess URL — they handle redirects)"
}

If the ingredient is unusual or you're uncertain, return what you know with appropriate hedging. Don't invent facts.`;

  const data = await postAi({
    model: ANTHROPIC_MODEL,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
  const text = (data.content?.[0]?.text || '').trim();
  const cleanJson = text.replace(/^```json\s*|\s*```$/g, '').replace(/^```\s*|\s*```$/g, '').trim();
  return JSON.parse(cleanJson);
}

// Extract a recipe from a social media post (TikTok, IG, YouTube, FB) — either via URL or pasted caption text.
// Two modes: URL → uses web_search to find caption/description; pasted text → direct AI parse.
async function extractRecipeFromSocial(input) {
  const trimmed = input.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);

  // Detect platform for friendlier UX
  let platform = 'other';
  if (isUrl) {
    if (/tiktok\.com/i.test(trimmed)) platform = 'tiktok';
    else if (/instagram\.com/i.test(trimmed)) platform = 'instagram';
    else if (/(youtube\.com|youtu\.be)/i.test(trimmed)) platform = 'youtube';
    else if (/facebook\.com/i.test(trimmed)) platform = 'facebook';
  }

  let prompt;
  if (isUrl) {
    prompt = `Extract a recipe from this social media post: ${trimmed}

This is likely from ${platform === 'other' ? 'a social platform (TikTok, Instagram, YouTube, Facebook)' : platform}.

Use the web_search tool to find the post. Look for the recipe in:
1. The post caption or video description (creators usually type the recipe there)
2. Pinned comments (especially on Instagram and TikTok)
3. Any external recipe page linked from the post

You probably can't access the video's audio — focus on caption text, description, or written comments where the creator typed the recipe.

Return ONLY a JSON object (no markdown, no preamble):
{
  "title": "string — give it a clear title even if the post doesn't have one (e.g. 'Viral TikTok Cottage Cheese Pasta')",
  "image_url": "string or null — post thumbnail if you can find a direct image URL",
  "ingredients": ["string", "..."],
  "instructions": ["string OR {\"text\": string, \"duration_min\": number}"],
  "prep_time": "string or null",
  "cook_time": "string or null",
  "servings": "string or null",
  "diet_tags": ["only from: ${DIET_TAGS.join(', ')}"],
  "notes": "string or null — credit the creator's @handle here if known",
  "source_platform": "tiktok | instagram | youtube | facebook | other"
}

For instructions: use plain strings by default. Only use the {text, duration_min} form when a step EXPLICITLY states a number of minutes or hours (e.g. "cook 5 min" → duration_min: 5). Steps without an explicit number stay as plain strings — never estimate.

If you cannot find any recipe text in captions/comments/linked pages:
{"error": "Could not find recipe text in this post. The recipe is probably only spoken in the video. Try copying the caption from the post and pasting it instead — we can extract it from text."}`;
  } else {
    prompt = `The user pasted text copied from a social media post (likely TikTok, Instagram Reel, or similar) that contains a recipe. Extract it into structured form.

Pasted text:
"""
${trimmed}
"""

Return ONLY a JSON object (no markdown, no preamble):
{
  "title": "string — generate a clear one if the text doesn't state it",
  "ingredients": ["string", "..."],
  "instructions": ["string OR {\"text\": string, \"duration_min\": number}"],
  "prep_time": "string or null",
  "cook_time": "string or null",
  "servings": "string or null",
  "diet_tags": ["only from: ${DIET_TAGS.join(', ')}"],
  "notes": "string or null — keep any creator credit/handle you see"
}

Rules:
- ingredients: one full ingredient line per string ("2 cups flour"). Don't nest.
- instructions: one step per entry. Use a plain string by default. Only use the {text, duration_min} form when a step EXPLICITLY states a number of minutes or hours (e.g. "simmer 10 minutes" → duration_min: 10). Steps without an explicit number stay plain strings — never estimate.
- If the text is a wall of prose, break it into logical sequential steps.
- Strip social-media filler: #hashtags, @mentions (unless attribution), "save this!", "double tap if you'll try!", random emojis used as decoration.
- Keep the substance. If a step says "🌶️ Add 1 tsp paprika", strip the emoji and keep "Add 1 tsp paprika".
- If the pasted text doesn't actually contain a recipe: {"error": "No recipe detected in the pasted text"}`;
  }

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }]
  };
  if (isUrl) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }

  const data = await postAi(body);
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse social media recipe');
  const parsed = JSON.parse(jsonMatch[0]);
  if (parsed.error) throw new Error(parsed.error);

  // Annotate source for the saved recipe
  return {
    ...parsed,
    source_url: isUrl ? trimmed : null,
    source_platform: parsed.source_platform || (isUrl ? platform : 'other')
  };
}

// AI estimates active cooking time per step. Used as an opt-in backfill for recipes
// imported before per-step durations were a feature, OR for recipes whose steps
// don't state explicit times. UNLIKE the import-time prompts (which forbid guessing),
// this function actively estimates because the user explicitly asked for it.
async function estimateStepTimes(steps) {
  const stepTexts = (steps || []).map(s => getStepText(s));
  const prompt = `Estimate the active cooking time in minutes for each of these recipe steps. Return ONE number per step (integer minutes), or null if no estimate is reasonable.

Estimate based on what the step actually involves:
- "Brown ground beef" → 5-7 min (browning takes time)
- "Drain fat" → 1 min (quick)
- "Bring to a simmer" → 3-5 min (waiting for liquid to heat)
- "Cook until fragrant, about 1 minute" → 1 min (explicit)
- "Bake at 400°F for 18 minutes" → 18 min (explicit)
- "Season with salt" → null (instant, not worth estimating)
- "Serve" / "Garnish" / "Enjoy" → null (no real cook time)
- "Make the pico by combining diced tomato, onion, lime, cilantro, jalapeño" → 5 min (chopping + mixing)
- "Whisk eggs, sugar, vanilla together" → 2 min
- "Rest the dough 1 hour" → 60 min (explicit)

Be realistic. Use null liberally for trivial steps. Only estimate when the step represents a meaningful chunk of active time.

Steps:
${JSON.stringify(stepTexts, null, 2)}

Return ONLY a JSON array of integers or null, one per step in the same order. Example: [6, 1, 4, 1, null, null]
No markdown, no preamble.`;

  const data = await postAi({
    model: ANTHROPIC_MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  });
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrMatch) throw new Error('Could not parse estimated times');
  const parsed = JSON.parse(arrMatch[0]);
  if (!Array.isArray(parsed)) throw new Error('Unexpected response shape');
  // Normalize: integers stay, anything else → null
  return parsed.map(v => (typeof v === 'number' && v > 0 && v < 600) ? Math.round(v) : null);
}

// ---------- Recipe duplicate detection ----------
// Two-tier: exact duplicate (same URL or same normalized title) and similar.
function normalizeTitle(t) {
  return (t || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function findExactDuplicate(recipes, candidate) {
  if (!candidate) return null;
  // Same source URL (cleaned)
  if (candidate.source_url) {
    const candUrl = cleanUrl(candidate.source_url).toLowerCase();
    const match = recipes.find(r => r.id !== candidate.id && r.source_url && cleanUrl(r.source_url).toLowerCase() === candUrl);
    if (match) return { recipe: match, reason: 'url' };
  }
  // Same normalized title
  if (candidate.title) {
    const norm = normalizeTitle(candidate.title);
    if (norm.length >= 3) {
      const match = recipes.find(r => r.id !== candidate.id && normalizeTitle(r.title) === norm);
      if (match) return { recipe: match, reason: 'title' };
    }
  }
  return null;
}
function findSimilarRecipes(recipes, candidate, limit = 3) {
  if (!candidate?.title) return [];
  const stopwords = new Set(['the','a','an','and','or','of','for','with','to','in','on','at','by','best','easy','quick','perfect','homemade','my','your','our']);
  const wordsOf = (t) => new Set(
    normalizeTitle(t).split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w))
  );
  const candWords = wordsOf(candidate.title);
  if (candWords.size === 0) return [];

  return recipes
    .filter(r => r.id !== candidate.id)
    .map(r => {
      const rWords = wordsOf(r.title);
      if (rWords.size === 0) return null;
      const intersection = [...candWords].filter(w => rWords.has(w)).length;
      const union = new Set([...candWords, ...rWords]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      return { recipe: r, score: jaccard, sharedWords: intersection };
    })
    .filter(x => x && (x.score >= 0.5 || x.sharedWords >= 2))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------- Recipe sharing (cookbook-to-cookbook) ----------
// Encodes a recipe as a base64 string that another user can paste into their Add flow.
// Strips heavy fields (cook_log, dataURL hero images) to keep the code paste-friendly.
function encodeRecipeForShare(recipe) {
  if (!recipe) return '';
  const minimal = {
    title: recipe.title,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    prep_time: recipe.prep_time,
    cook_time: recipe.cook_time,
    servings: recipe.servings,
    diet_tags: recipe.diet_tags,
    collections: recipe.collections,
    notes: recipe.notes,
    source_url: recipe.source_url,
    // Only include hero_image if it's a remote URL (not a base64 data URL — those make the code huge)
    hero_image: (recipe.hero_image && !recipe.hero_image.startsWith('data:')) ? recipe.hero_image : null,
    _shared_v: 1
  };
  // Strip nulls/empty arrays for compactness
  const trimmed = Object.fromEntries(
    Object.entries(minimal).filter(([_, v]) => v != null && (!Array.isArray(v) || v.length > 0))
  );
  const json = JSON.stringify(trimmed);
  // Use the URL-safe base64 to avoid pasting issues with `+` / `/` / `=`
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `saltpage-share-v1:${b64}`;
}
function decodeRecipeFromShare(code) {
  if (!code) throw new Error('Empty code');
  const trimmed = code.trim();
  // Accept new (saltpage-share-v1) or legacy (kitchen-share-v1) prefix; tolerant of extra whitespace
  const stripped = trimmed
    .replace(/^saltpage-share-v1:/, '')
    .replace(/^kitchen-share-v1:/, '')
    .replace(/\s+/g, '');
  if (!stripped) throw new Error('Empty code');
  // Restore standard base64 padding
  const standard = stripped.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - standard.length % 4) % 4);
  try {
    const json = decodeURIComponent(escape(atob(padded)));
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== 'object' || !obj.title) {
      throw new Error('Code does not contain a recipe');
    }
    return obj;
  } catch (e) {
    throw new Error('Could not read this code. Make sure you pasted the whole thing.');
  }
}

// ---------- Date helpers for meal plan ----------
function startOfWeek(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun
  // Treat Monday as start of week
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function formatWeekRange(monday) {
  const sunday = addDays(monday, 6);
  const opts = { month: 'short', day: 'numeric' };
  const a = monday.toLocaleDateString('en-US', opts);
  const b = sunday.toLocaleDateString('en-US', opts);
  return `${a} – ${b}`;
}
function dayLabel(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}
function shortDayLabel(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
}

// Detect if an ingredient/instruction line is a section header rather than an item.
// Recipes commonly group ingredients with headers like "For the sauce:", "Marinade", "Topping:"
const SECTION_PATTERNS = [
  /^for\s+the\s+.+:?\s*$/i,
  /^to\s+(serve|garnish|finish):?\s*$/i,
  /^.{2,40}:\s*$/,        // any short line ending with a colon
  /^(marinade|sauce|dressing|topping|filling|crust|glaze|frosting|streusel|crumble|garnish|base|dough)$/i
];
function isIngredientSection(line) {
  if (!line) return false;
  const trimmed = String(line).trim();
  // Section headers don't contain quantity numbers at the start
  if (/^\d/.test(trimmed)) return false;
  // Must be reasonably short
  if (trimmed.length > 50) return false;
  return SECTION_PATTERNS.some(re => re.test(trimmed));
}
function cleanSectionLabel(line) {
  return String(line).replace(/:?\s*$/, '').trim();
}

// ---------- Step helpers ----------
// Recipe instructions can be plain strings (legacy) OR { text, duration_min } objects.
// These helpers normalize access so the rest of the app doesn't care which shape it gets.
function getStepText(step) {
  if (step == null) return '';
  return typeof step === 'string' ? step : (step.text || '');
}
function getStepDuration(step) {
  if (typeof step === 'string') return null;
  return step?.duration_min ?? null;
}
function makeStep(text, duration_min) {
  if (!duration_min || isNaN(duration_min) || duration_min <= 0) return text;
  return { text, duration_min };
}
function totalStepDuration(steps) {
  let total = 0;
  let any = false;
  (steps || []).forEach(s => {
    const d = getStepDuration(s);
    if (d) { total += d; any = true; }
  });
  return any ? total : null;
}
function formatStepDuration(min) {
  if (!min) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Normalize freeform time strings for card metadata ("20 mins" → "20 min"). */
function formatRecipeTime(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s
    .replace(/\bminutes?\b/gi, 'min')
    .replace(/\bmins\b/gi, 'min')
    .replace(/\bhours?\b/gi, 'hr')
    .replace(/\bhrs\b/gi, 'hr');
}

/**
 * Consistent card eyebrow: prefer Serves N, else ingredient count with correct plural.
 * Strips redundant "serves/servings/makes" prefixes from stored servings strings.
 */
function formatCardEyebrow(recipe) {
  const raw = (recipe.servings || '').trim();
  if (raw) {
    const stripped = raw
      .replace(/^(serves|servings?|makes|yield)\s*:?\s*/i, '')
      .replace(/\s*(servings?|people|portions?)\s*$/i, '')
      .trim();
    if (stripped) return `Serves ${stripped}`;
  }
  const n = (recipe.ingredients || []).length;
  if (n <= 0) return 'Recipe';
  return n === 1 ? '1 ingredient' : `${n} ingredients`;
}

// ---------- Ingredient ↔ step matching ----------
// Connects ingredients to steps so cook mode can:
//   1. Highlight which ingredients are used in the current step (sidebar)
//   2. Annotate the step text with quantities inline ("garlic (3 cloves)")
const COOKING_UNITS = [
  'cup','cups','tablespoon','tablespoons','tbsp','tbsps','teaspoon','teaspoons','tsp','tsps',
  'pound','pounds','lb','lbs','ounce','ounces','oz','ozs','gram','grams','g',
  'kilogram','kilograms','kg','milliliter','milliliters','ml','mls','liter','liters','litre','litres','l',
  'clove','cloves','stick','sticks','pinch','pinches','dash','dashes',
  'handful','handfuls','bunch','bunches','head','heads','slice','slices',
  'can','cans','packet','packets','package','packages','sprig','sprigs','sheet','sheets','jar','jars'
];

// Parse an ingredient line into { amount, name }.
// "3 cloves garlic, minced" → { amount: "3 cloves", name: "garlic" }
// "1 pound lean ground beef" → { amount: "1 pound", name: "lean ground beef" }
// "salt and pepper" → { amount: "", name: "salt and pepper" }
function parseIngredientLine(line) {
  if (!line || typeof line !== 'string') return { amount: '', name: '' };
  // Strip parentheticals (e.g. "(add more if you like)")
  let cleaned = line.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  // Strip anything after the first comma (prep instruction)
  const commaIdx = cleaned.indexOf(',');
  if (commaIdx !== -1) cleaned = cleaned.slice(0, commaIdx).trim();
  // Match leading number(s) + optional unit
  const amountRegex = new RegExp(
    '^([\\d\\s\\/\\-.,½⅓¼⅔¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]+)(?:\\s+(' + COOKING_UNITS.join('|') + ')\\b)?\\s*',
    'i'
  );
  const m = cleaned.match(amountRegex);
  if (m && m[0].trim()) {
    return { amount: m[0].trim(), name: cleaned.slice(m[0].length).trim() };
  }
  return { amount: '', name: cleaned };
}

// Display-focused split: keeps prep instructions (minced, sliced) WITH the name,
// extracts parentheticals as separate "note", returns capitalized name for clean display.
// "3 cloves garlic, minced" → { amount: "3 cloves", name: "Garlic, minced", note: "" }
// "1/4 cup brown sugar (add more if sweeter)" → { amount: "1/4 cup", name: "Brown sugar", note: "add more if sweeter" }
// "salt and pepper" → { amount: "", name: "Salt and pepper", note: "" }
function splitIngredientForDisplay(line) {
  if (!line || typeof line !== 'string') return { amount: '', name: '', note: '' };
  const notes = [];
  // Pull out parentheticals → notes
  const mainText = line
    .replace(/\([^)]*\)/g, (match) => {
      notes.push(match.slice(1, -1).trim());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  // Extract leading amount (numbers + optional unit), KEEPING everything after
  const amountRegex = new RegExp(
    '^([\\d\\s\\/\\-.,½⅓¼⅔¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]+)(?:\\s+(' + COOKING_UNITS.join('|') + ')\\b)?\\s*',
    'i'
  );
  const m = mainText.match(amountRegex);
  let amount = '';
  let name = mainText;
  if (m && m[0].trim()) {
    amount = m[0].trim();
    name = mainText.slice(m[0].length).trim();
  }
  // Capitalize first letter for readability
  if (name) name = name.charAt(0).toUpperCase() + name.slice(1);
  return { amount, name, note: notes.join(' · ') };
}

// Generate the set of search terms (full phrase + last 2 words + last word) for matching.
// Skip very short or very common words to avoid false matches.
function getIngredientSearchTerms(name) {
  if (!name) return [];
  // Split on conjunctions/slashes — "salt and pepper" → ["salt", "pepper"]
  const parts = name.toLowerCase().split(/\s+(?:and|or)\s+|\//).map(s => s.trim()).filter(Boolean);
  const terms = new Set();
  // Skip overly generic single words that match too much in step text
  const tooGeneric = new Set(['oil','water','salt','sauce','stock','broth','liquid','mixture','ingredients']);
  for (const part of parts) {
    const words = part.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    if (part.length >= 3) terms.add(part);
    if (words.length >= 2) terms.add(words.slice(-2).join(' '));
    const lastWord = words[words.length - 1];
    if (lastWord.length >= 4 && !tooGeneric.has(lastWord)) terms.add(lastWord);
    if (lastWord.length >= 4 && tooGeneric.has(lastWord) && words.length === 1) {
      // single-word generic like "salt" — still add it, with word-boundary match it's fine
      terms.add(lastWord);
    }
  }
  return Array.from(terms);
}

function escapeRegexChars(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Does this ingredient line appear in this step's text?
function isIngredientInStep(ingredientLine, stepText) {
  if (!ingredientLine || !stepText) return false;
  if (isIngredientSection(ingredientLine)) return false;
  const { name } = parseIngredientLine(ingredientLine);
  const terms = getIngredientSearchTerms(name);
  for (const term of terms) {
    // Word boundaries + optional trailing s for plurals (onion/onions, carrot/carrots)
    const regex = new RegExp('\\b' + escapeRegexChars(term) + 's?\\b', 'i');
    if (regex.test(stepText)) return true;
  }
  return false;
}

// Find positions of ingredient mentions in step text → segments for inline rendering.
// Returns: [{ type: 'text', text }, { type: 'mention', text, amount }, ...]
function getStepSegments(stepText, ingredients) {
  if (!stepText) return [{ type: 'text', text: '' }];
  const mentions = [];
  for (const ing of ingredients || []) {
    if (typeof ing !== 'string' || isIngredientSection(ing)) continue;
    const { amount, name } = parseIngredientLine(ing);
    if (!amount) continue; // no point annotating without an amount to show
    const terms = getIngredientSearchTerms(name);
    for (const term of terms) {
      const regex = new RegExp('\\b' + escapeRegexChars(term) + 's?\\b', 'gi');
      let m;
      while ((m = regex.exec(stepText)) !== null) {
        mentions.push({
          start: m.index,
          end: m.index + m[0].length,
          amount,
          termLength: term.length
        });
      }
    }
  }
  if (mentions.length === 0) return [{ type: 'text', text: stepText }];
  // Sort earliest first, longest-match wins for ties (so "ground beef" beats "beef")
  mentions.sort((a, b) => a.start - b.start || b.termLength - a.termLength);
  // Dedupe overlapping mentions + don't repeat the same amount in one step
  const kept = [];
  let lastEnd = -1;
  const seenAmounts = new Set();
  for (const m of mentions) {
    if (m.start < lastEnd) continue;
    if (seenAmounts.has(m.amount)) continue;
    seenAmounts.add(m.amount);
    kept.push(m);
    lastEnd = m.end;
  }
  // Build segments
  const segments = [];
  let pos = 0;
  for (const m of kept) {
    if (m.start > pos) segments.push({ type: 'text', text: stepText.slice(pos, m.start) });
    segments.push({ type: 'mention', text: stepText.slice(m.start, m.end), amount: m.amount });
    pos = m.end;
  }
  if (pos < stepText.length) segments.push({ type: 'text', text: stepText.slice(pos) });
  return segments;
}

// ---------- AutoGrowTextarea ----------
// Replaces fixed-rows textareas. Auto-resizes to fit its content so nothing gets cut off.
function AutoGrowTextarea({ value, onChange, minRows = 2, ...rest }) {
  const ref = React.useRef(null);
  const adjust = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);
  React.useEffect(() => { adjust(); }, [value, adjust]);
  // Adjust on mount and when fonts/layout settle
  React.useEffect(() => {
    adjust();
    const id = window.setTimeout(adjust, 50);
    return () => window.clearTimeout(id);
  }, [adjust]);
  return (
    <textarea
      ref={ref}
      value={value || ''}
      rows={minRows}
      onChange={e => { onChange(e); adjust(); }}
      onInput={adjust}
      style={{ overflow: 'hidden', resize: 'none', ...((rest.style) || {}) }}
      {...rest}
    />
  );
}

// ---------- Timer helpers ----------
// Parse a duration from instruction text. Returns total seconds, or null.
// Handles "20 minutes", "1 hour", "30 sec", "1 1/2 hours", "20-25 min", "20 to 25 minutes".
function parseDuration(text) {
  if (!text) return null;
  // Pattern: number (whole, decimal, fraction, or mixed) + optional range + unit
  const re = /\b(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?:\s*(?:to|-|–|—)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i;
  const m = text.match(re);
  if (!m) return null;

  const parseNum = (s) => {
    if (s.includes(' ')) {
      const [whole, frac] = s.split(/\s+/);
      const [n, d] = frac.split('/').map(Number);
      return parseInt(whole) + n / d;
    }
    if (s.includes('/')) {
      const [n, d] = s.split('/').map(Number);
      return n / d;
    }
    return parseFloat(s);
  };

  const lower = parseNum(m[1]);
  const upper = m[2] ? parseFloat(m[2]) : lower;
  const value = Math.max(lower, upper); // for ranges, use the upper bound

  const unit = m[3].toLowerCase();
  let seconds;
  if (unit.startsWith('h')) seconds = value * 3600;
  else if (unit.startsWith('m')) seconds = value * 60;
  else seconds = value;

  return Math.round(seconds);
}

function formatTimerDisplay(totalSeconds) {
  if (totalSeconds < 0) totalSeconds = 0;
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatTimerLabel(totalSeconds) {
  if (totalSeconds >= 3600) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.round((totalSeconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (totalSeconds >= 60) return `${Math.round(totalSeconds / 60)} min`;
  return `${totalSeconds}s`;
}

// Play a soft chime using Web Audio API (no external file needed)
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const playTone = (freq, startDelay, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + startDelay;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    };
    playTone(880, 0, 0.35);
    playTone(1320, 0.35, 0.45);
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* silent — audio is best-effort */ }
}

// ---------- Pretty share: render recipe as an image ----------
async function renderRecipeAsImage(recipe) {
  // Wait for fonts to be ready so canvas text uses the right typefaces
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch {}
  }

  const W = 1080;            // output width in CSS pixels
  const dpr = 2;             // render at 2x for crisp output
  const PAD = 56;
  const HERO_H = 540;        // hero image height
  const COLORS = {
    paper: '#f4ede0',
    paperDeep: '#ebe1cf',
    ink: '#1f1810',
    inkSoft: '#5a4d3f',
    inkFaint: '#8a7d6f',
    tomato: '#b34a2c',
    line: '#d8cdb8'
  };

  // Helper: load an image (supports data URLs and same-origin URLs).
  // Returns null on cross-origin failure (we can't taint the canvas).
  const loadImage = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  const heroImg = await loadImage(recipe.hero_image);

  // First pass: measure to compute total height
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');

  const wrap = (text, font, maxWidth) => {
    mctx.font = font;
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let current = '';
    for (const w of words) {
      const test = current ? `${current} ${w}` : w;
      if (mctx.measureText(test).width <= maxWidth) current = test;
      else { if (current) lines.push(current); current = w; }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  };

  const titleFont = '300 60px Fraunces, Georgia, serif';
  const sectionFont = '400 22px Fraunces, Georgia, serif';
  const bodyFont = '400 16px "DM Sans", system-ui, sans-serif';
  const labelFont = '500 11px "DM Sans", system-ui, sans-serif';
  const stepNumFont = '300 28px Fraunces, Georgia, serif';

  const contentW = W - PAD * 2;
  const titleLines = wrap(recipe.title, titleFont, contentW);

  // Two-column: ingredients (left ~36%) and method (right ~60%) with gutter
  const colGap = 40;
  const ingW = Math.round(contentW * 0.36);
  const methodW = contentW - ingW - colGap;

  // Pre-wrap ingredients
  const ingLines = (recipe.ingredients || []).map(ing => wrap(ing, bodyFont, ingW - 16));
  // Pre-wrap method (each step prefixed by a number column)
  const stepNumW = 36;
  const stepBodyW = methodW - stepNumW;
  const stepLines = (recipe.instructions || []).map(s => wrap(getStepText(s), bodyFont, stepBodyW));

  // Compute heights
  const titleLH = 64;
  const bodyLH = 26;
  const stepBodyLH = 26;
  const stepGap = 16;
  const ingGap = 8;

  const titleH = titleLines.length * titleLH;
  const ingsH = ingLines.reduce((sum, l) => sum + l.length * bodyLH + ingGap, 0);
  const stepsH = stepLines.reduce((sum, l) => sum + Math.max(stepNumFont ? 36 : 0, l.length * stepBodyLH) + stepGap, 0);
  const colsH = Math.max(ingsH + 60, stepsH + 60); // +60 for "Ingredients"/"Method" headers

  // Stats row (prep/cook/serves) ~50px
  const statsH = (recipe.prep_time || recipe.cook_time || recipe.servings) ? 60 : 0;

  // Diet tag chips ~40px if any
  const tagsH = (recipe.diet_tags && recipe.diet_tags.length) ? 44 : 0;

  // Notes box (if any)
  const notesLines = recipe.notes ? wrap(recipe.notes, bodyFont, contentW - 32) : [];
  const notesH = notesLines.length ? notesLines.length * bodyLH + 60 : 0;

  // Footer ~80px (source URL + watermark)
  const footerH = 100;

  let H = (heroImg ? HERO_H : PAD) + PAD + titleH + 24 + tagsH + statsH + 40 + colsH + notesH + footerH;
  H = Math.max(H, 800);

  // Set up real canvas at dpr resolution
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';

  // Background
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, W, H);

  let y = 0;

  // Hero
  if (heroImg) {
    // Cover-fit the image into W x HERO_H
    const ar = heroImg.width / heroImg.height;
    const targetAr = W / HERO_H;
    let sx = 0, sy = 0, sW = heroImg.width, sH = heroImg.height;
    if (ar > targetAr) {
      sW = heroImg.height * targetAr;
      sx = (heroImg.width - sW) / 2;
    } else {
      sH = heroImg.width / targetAr;
      sy = (heroImg.height - sH) / 2;
    }
    try {
      ctx.drawImage(heroImg, sx, sy, sW, sH, 0, 0, W, HERO_H);
    } catch {
      // tainted canvas; fall back to no hero
    }
    y = HERO_H + PAD;
  } else {
    y = PAD;
  }

  // Label "Recipe"
  ctx.font = labelFont;
  ctx.fillStyle = COLORS.inkFaint;
  ctx.fillText('RECIPE', PAD, y);
  y += 28;

  // Title
  ctx.font = titleFont;
  ctx.fillStyle = COLORS.ink;
  for (const line of titleLines) {
    ctx.fillText(line, PAD, y + 44);
    y += titleLH;
  }
  y += 24;

  // Diet tags
  if (tagsH) {
    ctx.font = labelFont;
    let cx = PAD;
    for (const t of recipe.diet_tags) {
      const w = ctx.measureText(t).width + 24;
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      // rounded pill
      const r = 14;
      ctx.moveTo(cx + r, y - 6);
      ctx.arcTo(cx + w, y - 6, cx + w, y + 22, r);
      ctx.arcTo(cx + w, y + 22, cx, y + 22, r);
      ctx.arcTo(cx, y + 22, cx, y - 6, r);
      ctx.arcTo(cx, y - 6, cx + w, y - 6, r);
      ctx.stroke();
      ctx.fillStyle = COLORS.inkSoft;
      ctx.fillText(t, cx + 12, y + 12);
      cx += w + 8;
      if (cx > W - PAD - 100) break;
    }
    y += tagsH;
  }

  // Stats
  if (statsH) {
    const stats = [
      recipe.prep_time && { label: 'PREP', value: recipe.prep_time },
      recipe.cook_time && { label: 'COOK', value: recipe.cook_time },
      recipe.servings && { label: 'SERVES', value: recipe.servings }
    ].filter(Boolean);
    let sx = PAD;
    for (const s of stats) {
      ctx.font = labelFont;
      ctx.fillStyle = COLORS.inkFaint;
      ctx.fillText(s.label, sx, y + 14);
      ctx.font = bodyFont;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(s.value, sx, y + 38);
      sx += Math.max(140, ctx.measureText(s.value).width + 60);
    }
    y += statsH;
  }

  // Divider
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 32;

  // Two-column layout: Ingredients / Method
  const colTop = y;

  // Ingredients header
  ctx.font = sectionFont;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('Ingredients', PAD, y + 22);

  // Method header
  ctx.fillText('Method', PAD + ingW + colGap, y + 22);

  let iy = y + 22 + 32;
  let my = y + 22 + 32;

  // Ingredients
  ctx.font = bodyFont;
  ctx.fillStyle = COLORS.ink;
  for (const lines of ingLines) {
    // bullet
    ctx.fillStyle = COLORS.tomato;
    ctx.fillText('·', PAD, iy);
    ctx.fillStyle = COLORS.ink;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], PAD + 16, iy);
      if (i < lines.length - 1) iy += bodyLH;
    }
    iy += bodyLH + ingGap;
  }

  // Method
  for (let si = 0; si < stepLines.length; si++) {
    const lines = stepLines[si];
    // step number
    ctx.font = stepNumFont;
    ctx.fillStyle = COLORS.tomato;
    ctx.fillText(String(si + 1), PAD + ingW + colGap, my + 4);
    // step body
    ctx.font = bodyFont;
    ctx.fillStyle = COLORS.ink;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], PAD + ingW + colGap + stepNumW, my + i * stepBodyLH);
    }
    my += Math.max(36, lines.length * stepBodyLH) + stepGap;
  }

  y = Math.max(iy, my) + 16;

  // Notes
  if (notesH) {
    ctx.fillStyle = COLORS.paperDeep;
    ctx.fillRect(PAD, y, contentW, notesH - 16);
    ctx.strokeStyle = COLORS.tomato;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(PAD, y + notesH - 16);
    ctx.stroke();
    ctx.font = labelFont;
    ctx.fillStyle = COLORS.inkFaint;
    ctx.fillText('NOTES', PAD + 16, y + 24);
    ctx.font = bodyFont;
    ctx.fillStyle = COLORS.inkSoft;
    let ny = y + 50;
    for (const ln of notesLines) {
      ctx.fillText(ln, PAD + 16, ny);
      ny += bodyLH;
    }
    y += notesH;
  }

  // Footer
  ctx.strokeStyle = COLORS.line;
  ctx.beginPath();
  ctx.moveTo(PAD, H - footerH);
  ctx.lineTo(W - PAD, H - footerH);
  ctx.stroke();

  ctx.font = labelFont;
  ctx.fillStyle = COLORS.inkFaint;
  if (recipe.source_url) {
    ctx.fillText('FROM', PAD, H - footerH + 30);
    ctx.font = bodyFont;
    ctx.fillStyle = COLORS.inkSoft;
    const cleanedUrl = cleanUrl(recipe.source_url);
    const urlLines = wrap(cleanedUrl, bodyFont, contentW - 200);
    ctx.fillText(urlLines[0] || '', PAD, H - footerH + 56);
  }

  // Watermark "salt & page."
  // Multi-part render so the ampersand and period get tomato italic treatment
  const wmY = H - footerH + 50;
  const wmFont = '400 22px Fraunces, Georgia, serif';
  const wmItalicFont = 'italic 400 22px Fraunces, Georgia, serif';

  ctx.font = wmFont;
  const w_salt = ctx.measureText('salt ').width;
  ctx.font = wmItalicFont;
  const w_amp = ctx.measureText('&').width;
  ctx.font = wmFont;
  const w_page = ctx.measureText(' page').width;
  ctx.font = wmItalicFont;
  const w_dot = ctx.measureText('.').width;

  const totalWmW = w_salt + w_amp + w_page + w_dot;
  let wmX = W - PAD - totalWmW;

  ctx.font = wmFont;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('salt ', wmX, wmY);
  wmX += w_salt;

  ctx.font = wmItalicFont;
  ctx.fillStyle = COLORS.tomato;
  ctx.fillText('&', wmX, wmY);
  wmX += w_amp;

  ctx.font = wmFont;
  ctx.fillStyle = COLORS.ink;
  ctx.fillText(' page', wmX, wmY);
  wmX += w_page;

  ctx.font = wmItalicFont;
  ctx.fillStyle = COLORS.tomato;
  ctx.fillText('.', wmX, wmY);

  return canvas.toDataURL('image/png');
}

// ---------- Storage helpers ----------
const SHOPPING_KEY = 'shopping_list_current';
const MEAL_PLAN_KEY = 'meal_plan';
const PLAN_KEY = 'subscription_plan';
const PANTRY_KEY = 'pantry_current';
const ONBOARDED_KEY = 'onboarded_v1';
const USER_SUBS_KEY = 'user_subs';
const PREFS_KEY = 'prefs';

// ---------- Freemium tiers ----------
const PLAN_DETAILS = {
  free: {
    name: 'Free',
    price: 0,
    pricePeriod: '',
    tagline: 'The cookbook'
  },
  plus: {
    name: 'Plus',
    price: 4.99,
    pricePeriod: '/mo',
    yearly: 39,
    tagline: 'AI features + planning'
  },
  family: {
    name: 'Family',
    price: 7.99,
    pricePeriod: '/mo',
    yearly: 59,
    tagline: 'For households'
  }
};

const LIMITS = {
  free: {
    recipes_max: 25,
    url_extract: 3,
    photo_extract: 3,
    social_extract: 0,
    method_adapt: 0,
    substitutions: 0,
    shopping_consolidate: 0,
    meal_plan_send_to_shopping: false,
    image_export_watermark: true,
    sync_devices: false
  },
  plus: {
    recipes_max: Infinity,
    url_extract: Infinity,
    photo_extract: Infinity,
    social_extract: Infinity,
    method_adapt: Infinity,
    substitutions: Infinity,
    shopping_consolidate: Infinity,
    meal_plan_send_to_shopping: true,
    image_export_watermark: false,
    sync_devices: true
  },
  family: {
    recipes_max: Infinity,
    url_extract: Infinity,
    photo_extract: Infinity,
    social_extract: Infinity,
    method_adapt: Infinity,
    substitutions: Infinity,
    shopping_consolidate: Infinity,
    meal_plan_send_to_shopping: true,
    image_export_watermark: false,
    sync_devices: true,
    household_members: 5
  }
};

const FEATURE_LABELS = {
  url_extract: 'Extract recipe from URL',
  photo_extract: 'Extract recipe from photo',
  social_extract: 'Extract from TikTok/Instagram/YouTube',
  method_adapt: 'AI-adapt method to scale',
  substitutions: 'AI substitutions',
  shopping_consolidate: 'AI shopping list consolidation',
  meal_plan_send_to_shopping: 'Send week to shopping list',
  recipes_max: 'Save recipes'
};

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function canUseFeature(plan, feature) {
  const limit = LIMITS[plan.tier]?.[feature];
  if (limit === undefined) return { allowed: true };
  if (limit === true) return { allowed: true };
  if (limit === false) return { allowed: false, limit: 0, used: 0, remaining: 0, reason: 'plan' };
  if (limit === Infinity) return { allowed: true, unlimited: true };
  // Numeric usage cap
  const used = plan.usage?.[feature] || 0;
  if (used >= limit) {
    return { allowed: false, used, limit, remaining: 0, reason: 'usage' };
  }
  return { allowed: true, used, limit, remaining: limit - used };
}

function canSaveAnotherRecipe(plan, currentCount) {
  const limit = LIMITS[plan.tier]?.recipes_max;
  if (limit === Infinity) return { allowed: true, unlimited: true };
  if (currentCount >= limit) {
    return { allowed: false, used: currentCount, limit, reason: 'recipes' };
  }
  return { allowed: true, used: currentCount, limit, remaining: limit - currentCount };
}

const storage = {
  async list() {
    try {
      const result = await window.storage.list(STORAGE_PREFIX);
      const keys = result?.keys || [];
      const recipes = await Promise.all(
        keys.map(async (k) => {
          try {
            const r = await window.storage.get(k);
            return r ? JSON.parse(r.value) : null;
          } catch { return null; }
        })
      );
      return recipes.filter(Boolean).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    } catch (e) {
      console.error('list failed', e);
      return [];
    }
  },
  async save(recipe) {
    const key = `${STORAGE_PREFIX}${recipe.id}`;
    await window.storage.set(key, JSON.stringify(recipe));
  },
  async remove(id) {
    await window.storage.delete(`${STORAGE_PREFIX}${id}`);
  },
  async getShoppingList() {
    try {
      const r = await window.storage.get(SHOPPING_KEY);
      return r ? JSON.parse(r.value) : { recipes: [], items: [], generated_at: null };
    } catch {
      return { recipes: [], items: [], generated_at: null };
    }
  },
  async saveShoppingList(list) {
    await window.storage.set(SHOPPING_KEY, JSON.stringify(list));
  },
  async getMealPlan() {
    try {
      const r = await window.storage.get(MEAL_PLAN_KEY);
      return r ? JSON.parse(r.value) : { days: {} };
    } catch {
      return { days: {} };
    }
  },
  async saveMealPlan(plan) {
    await window.storage.set(MEAL_PLAN_KEY, JSON.stringify(plan));
  },
  async getPlan() {
    try {
      const r = await window.storage.get(PLAN_KEY);
      const stored = r ? JSON.parse(r.value) : null;
      const cur = getCurrentMonth();
      // Default to free; reset usage if month rolled over
      if (!stored) return { tier: 'free', usage: { month: cur }, started_at: Date.now() };
      if (stored.usage?.month !== cur) {
        return { ...stored, usage: { month: cur } };
      }
      return stored;
    } catch {
      return { tier: 'free', usage: { month: getCurrentMonth() }, started_at: Date.now() };
    }
  },
  async savePlan(plan) {
    await window.storage.set(PLAN_KEY, JSON.stringify(plan));
  },
  async getPantry() {
    try {
      const r = await window.storage.get(PANTRY_KEY);
      return r ? JSON.parse(r.value) : { items: [] };
    } catch {
      return { items: [] };
    }
  },
  async savePantry(p) {
    await window.storage.set(PANTRY_KEY, JSON.stringify(p));
  },
  async getOnboarded() {
    try {
      const r = await window.storage.get(ONBOARDED_KEY);
      return r ? JSON.parse(r.value) : false;
    } catch { return false; }
  },
  async setOnboarded(val) {
    await window.storage.set(ONBOARDED_KEY, JSON.stringify(val));
  },
  async getUserSubs() {
    try {
      const r = await window.storage.get(USER_SUBS_KEY);
      return r ? JSON.parse(r.value) : { items: [] };
    } catch {
      return { items: [] };
    }
  },
  async saveUserSubs(subs) {
    await window.storage.set(USER_SUBS_KEY, JSON.stringify(subs));
  },
  async getPrefs() {
    try {
      const r = await window.storage.get(PREFS_KEY);
      const defaults = { showIngredientInfo: true };
      return r ? { ...defaults, ...JSON.parse(r.value) } : defaults;
    } catch {
      return { showIngredientInfo: true };
    }
  },
  async savePrefs(prefs) {
    await window.storage.set(PREFS_KEY, JSON.stringify(prefs));
  }
};

// ---------- AI extraction ----------
async function extractRecipeFromUrl(url) {
  const prompt = `Use the web_search tool to find this recipe page: ${url}

If the first search doesn't surface enough detail, search again — try the URL slug, the recipe name from the slug, or "site:domain.com recipe-name". You should run multiple searches if needed to find the actual recipe content and the page's hero image.

Return ONLY a JSON object (no markdown, no code fences, no preamble) with this exact shape:
{
  "title": "string",
  "image_url": "string or null — the URL of the main recipe photo. Look hard for this. It's typically: (a) the og:image meta tag visible in social-share cards, (b) the schema.org Recipe JSON-LD image field, (c) the largest hero image on the page. Must be a direct image URL ending in .jpg/.jpeg/.png/.webp (or with image-serving query strings). Never a page link, never a placeholder, never null unless you genuinely cannot find one after searching.",
  "ingredients": ["string", "..."],
  "instructions": ["string OR {\"text\": string, \"duration_min\": number}"],
  "prep_time": "string or null (e.g. '15 min')",
  "cook_time": "string or null",
  "servings": "string or null (e.g. '4 servings')",
  "diet_tags": ["string"],
  "notes": "string or null"
}

Rules:
- ingredients: each string is one full ingredient line (e.g. "2 cups flour"). Do not nest.
- ingredient SECTIONS: if the recipe groups ingredients (e.g. "For the sauce:", "Marinade:"), include those exactly as separate string entries between the items they group. Example: ["For the dough:", "2 cups flour", "1 tsp salt", "For the sauce:", "1 can tomatoes", "..."]
- instructions: each step is ONE entry. Use a plain string by default. ONLY use the {text, duration_min} form when the step text EXPLICITLY states a number of minutes or hours (e.g. "simmer 20 minutes" → duration_min: 20, "bake 15-18 min" → duration_min: 17, "rest 1 hour" → duration_min: 60). Skip headers like "For the sauce:".
  STRICT: do NOT estimate durations for steps without an explicit numeric time. These should ALL be plain strings, no duration_min:
  * "Drain excess fat" — no number, plain string
  * "Brown the meat" — no number, plain string
  * "Cook until fragrant" — "until X" is not a number, plain string
  * "Bring to a simmer, stirring until glossy" — no number, plain string
  * "Season with salt and pepper" — plain string
  Only when a NUMBER is explicit ("about 1 minute", "for 5-7 min", "30 seconds") do you use the object form.
- diet_tags: only from this list, only if clearly applicable: ${DIET_TAGS.join(', ')}
- Skip the personal story and ad copy. Just the recipe.
- If no recipe found, return: {"error": "reason"}`;

  const data = await postAi({
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }]
  });
  const text = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse recipe from page');
  const parsed = JSON.parse(jsonMatch[0]);
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

// ---------- Main App ----------
export default function App() {
  const [view, setView] = useState('cookbook'); // cookbook | shopping | journal | plan | add | detail | edit | cook
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeRecipe, setActiveRecipe] = useState(null);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [activeCollection, setActiveCollection] = useState(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pantryIngredients, setPantryIngredients] = useState([]);
  const [shoppingList, setShoppingList] = useState({ recipes: [], items: [], generated_at: null });
  const [mealPlan, setMealPlan] = useState({ days: {} });
  const [pendingDelete, setPendingDelete] = useState(null);
  const [plan, setPlan] = useState({ tier: 'free', usage: { month: getCurrentMonth() } });
  const [upgradePrompt, setUpgradePrompt] = useState(null);
  const [pantry, setPantry] = useState({ items: [] });
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [userSubs, setUserSubs] = useState({ items: [] });
  const [prefs, setPrefs] = useState({ showIngredientInfo: true });
  const [addInitialMode, setAddInitialMode] = useState('url');

  useEffect(() => {
    storage.list().then(r => { setRecipes(r); setLoading(false); });
    storage.getShoppingList().then(setShoppingList);
    storage.getMealPlan().then(setMealPlan);
    storage.getPantry().then(setPantry);
    storage.getUserSubs().then(setUserSubs);
    storage.getPrefs().then(setPrefs);
    storage.getPlan().then(p => {
      const cur = getCurrentMonth();
      if (p.usage?.month !== cur) {
        const reset = { ...p, usage: { month: cur } };
        storage.savePlan(reset);
        setPlan(reset);
      } else {
        setPlan(p);
      }
    });
    // Show onboarding to first-time users with no recipes
    storage.getOnboarded().then(async (onboarded) => {
      if (!onboarded) {
        const list = await storage.list();
        if (list.length === 0) setShowOnboarding(true);
      }
    });
  }, []);

  const dismissOnboarding = async () => {
    // Hide immediately — don't make the user wait on storage
    setShowOnboarding(false);
    // Persist in the background. If storage fails (rare, but possible on
    // mobile), they'll just see onboarding once more next session — not fatal.
    try {
      await storage.setOnboarded(true);
    } catch (e) {
      console.warn('Could not persist onboarded state:', e);
    }
  };

  // Pantry handlers
  const addPantryItem = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (pantry.items.some(i => i.name.toLowerCase() === trimmed.toLowerCase())) return;
    const next = {
      items: [...pantry.items, { id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name: trimmed, added_at: Date.now() }]
    };
    await storage.savePantry(next);
    setPantry(next);
  };
  const removePantryItem = async (id) => {
    const next = { items: pantry.items.filter(i => i.id !== id) };
    await storage.savePantry(next);
    setPantry(next);
  };
  const clearPantry = async () => {
    await storage.savePantry({ items: [] });
    setPantry({ items: [] });
  };

  // ---- User substitutions ----
  const addUserSub = async ({ ingredient, swap, ratio, notes }) => {
    if (!ingredient?.trim() || !swap?.trim()) return null;
    const next = {
      items: [
        ...userSubs.items,
        {
          id: `us_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          ingredient: ingredient.trim(),
          swap: swap.trim(),
          ratio: (ratio || '').trim(),
          notes: (notes || '').trim(),
          created_at: Date.now()
        }
      ]
    };
    await storage.saveUserSubs(next);
    setUserSubs(next);
    return next.items[next.items.length - 1];
  };
  const updateUserSub = async (id, patch) => {
    const next = {
      items: userSubs.items.map(s => s.id === id ? { ...s, ...patch, updated_at: Date.now() } : s)
    };
    await storage.saveUserSubs(next);
    setUserSubs(next);
  };
  const removeUserSub = async (id) => {
    const next = { items: userSubs.items.filter(s => s.id !== id) };
    await storage.saveUserSubs(next);
    setUserSubs(next);
  };

  // ---- Preferences ----
  const updatePrefs = async (patch) => {
    const next = { ...prefs, ...patch };
    await storage.savePrefs(next);
    setPrefs(next);
  };
  const moveCheckedShoppingToPantry = async () => {    const checkedItems = (shoppingList.items || []).filter(it => it.checked);
    if (checkedItems.length === 0) return 0;
    // Add unique ones (case-insensitive name match)
    const existingLower = new Set(pantry.items.map(i => i.name.toLowerCase()));
    const toAdd = checkedItems
      .filter(it => !existingLower.has(it.name.toLowerCase()))
      .map(it => ({
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${it.id.slice(-4)}`,
        name: it.name,
        added_at: Date.now(),
        from_shopping: true
      }));
    const nextPantry = { items: [...pantry.items, ...toAdd] };
    await storage.savePantry(nextPantry);
    setPantry(nextPantry);
    // Remove the checked items from the shopping list
    const nextShop = { ...shoppingList, items: shoppingList.items.filter(it => !it.checked) };
    await storage.saveShoppingList(nextShop);
    setShoppingList(nextShop);
    return toAdd.length;
  };

  // Bump usage counter for an AI feature (after successful call)
  const bumpUsage = async (feature) => {
    const next = {
      ...plan,
      usage: {
        ...(plan.usage || {}),
        [feature]: (plan.usage?.[feature] || 0) + 1
      }
    };
    await storage.savePlan(next);
    setPlan(next);
  };

  // Try to use a feature. If blocked, opens upgrade modal and returns false.
  const requireFeature = (feature) => {
    const check = canUseFeature(plan, feature);
    if (!check.allowed) {
      setUpgradePrompt({ feature, check });
      return false;
    }
    return true;
  };

  const changeTier = (newTier) => {
    const next = { ...plan, tier: newTier, started_at: plan.started_at || Date.now() };
    // Update UI state immediately — never gate UI on async storage which can hang on mobile.
    setPlan(next);
    // Persist in background; if storage fails the UI is still correct in-session.
    storage.savePlan(next).catch(err => console.warn('savePlan failed:', err));
  };

  const refresh = async () => setRecipes(await storage.list());

  // Title + ingredients + instructions + notes search; tag + collection filter
  const filtered = useMemo(() => {
    let result = recipes.filter(r => {
      if (pendingDelete?.recipe?.id === r.id) return false;
      if (favoritesOnly && !r.favorite) return false;
      if (activeTag && !(r.diet_tags || []).includes(activeTag)) return false;
      if (activeCollection && !(r.collections || []).includes(activeCollection)) return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        const haystack = [
          r.title || '',
          ...(r.ingredients || []),
          ...(r.instructions || []).map(s => getStepText(s)),
          r.notes || '',
          ...(r.collections || []),
          ...(r.diet_tags || [])
        ].join(' \n ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    // Pantry / ingredient search: rank by match count.
    // Combine session-only chips with persistent pantry items.
    const allPantryNames = [
      ...pantryIngredients,
      ...pantry.items.map(i => i.name)
    ];
    if (allPantryNames.length > 0) {
      const lcPantry = allPantryNames.map(p => p.toLowerCase().trim()).filter(Boolean);
      const dedup = [...new Set(lcPantry)];
      result = result
        .map(r => {
          const ingsText = (r.ingredients || []).map(i => i.toLowerCase()).join(' | ');
          const matches = dedup.filter(p => ingsText.includes(p));
          return { recipe: r, matchCount: matches.length, totalIngredients: (r.ingredients || []).length };
        })
        .filter(x => x.matchCount > 0 || pantryIngredients.length === 0)
        .sort((a, b) => {
          if (pantryIngredients.length > 0) return b.matchCount - a.matchCount;
          // If only persistent pantry, sort by match ratio not absolute (recipes with mostly-available ingredients first)
          const ar = a.matchCount / Math.max(1, a.totalIngredients);
          const br = b.matchCount / Math.max(1, b.totalIngredients);
          return br - ar;
        });
    }

    return result;
  }, [recipes, search, activeTag, activeCollection, pantryIngredients, pantry, favoritesOnly, pendingDelete]);

  const usedTags = useMemo(() => {
    const tagSet = new Set();
    recipes.forEach(r => (r.diet_tags || []).forEach(t => tagSet.add(t)));
    // Predefined first (in DIET_TAGS order), then custom (alphabetical)
    const predefinedUsed = DIET_TAGS.filter(t => tagSet.has(t));
    const customUsed = [...tagSet].filter(t => !DIET_TAGS.includes(t)).sort();
    return [...predefinedUsed, ...customUsed];
  }, [recipes]);

  const allCollections = useMemo(() => {
    const set = new Set();
    recipes.forEach(r => (r.collections || []).forEach(c => set.add(c)));
    return [...set].sort();
  }, [recipes]);

  const allCookLog = useMemo(() => {
    const entries = [];
    recipes.forEach(r => {
      (r.cook_log || []).forEach(e => {
        entries.push({ ...e, recipeId: r.id, recipeTitle: r.title, recipeHero: r.hero_image });
      });
    });
    return entries.sort((a, b) => (b.date || 0) - (a.date || 0));
  }, [recipes]);

  // Count meals scheduled this week
  const thisWeekMealCount = useMemo(() => {
    const weekStart = startOfWeek();
    let count = 0;
    for (let i = 0; i < 7; i++) {
      const day = mealPlan.days?.[isoDate(addDays(weekStart, i))];
      if (day) {
        ['breakfast', 'lunch', 'dinner'].forEach(m => { if (day[m]) count++; });
      }
    }
    return count;
  }, [mealPlan]);

  const showTopNav = ['cookbook', 'shopping', 'journal', 'plan', 'settings'].includes(view);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..900,0..100;1,9..144,300..900,0..100&family=Geist:wght@300..900&family=DM+Sans:opsz,wght@9..40,300..700&family=JetBrains+Mono:wght@400;500&display=swap');

        :root {
          --paper: #f4ede0;
          --paper-deep: #ebe1cf;
          --ink: #1f1810;
          --ink-soft: #5a4d3f;
          --ink-faint: #8a7d6f;
          --tomato: #b34a2c;
          --tomato-deep: #8a3820;
          --olive: #6b6233;
          --line: #d8cdb8;
        }

        .recipe-app { font-family: 'DM Sans', sans-serif; background: var(--paper); color: var(--ink); min-height: 100vh; }
        .recipe-app * { box-sizing: border-box; }
        /* Display font — modern bold geometric sans for headlines and recipe titles.
           The wordmark (salt & page.) uses Fraunces inline for brand identity; it's not affected by this class. */
        .display { font-family: 'Geist', 'Inter', system-ui, sans-serif; font-weight: 500; letter-spacing: -0.025em; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .label { font-family: 'DM Sans', sans-serif; text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; font-weight: 500; color: var(--ink-faint); }

        .grain {
          position: fixed; inset: 0; pointer-events: none; opacity: 0.04; z-index: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .btn-primary { background: var(--ink); color: var(--paper); padding: 10px 18px; border-radius: 2px; font-size: 14px; font-weight: 500; transition: all 0.2s; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; }
        .btn-primary:hover { background: var(--tomato); transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .btn-ghost { background: transparent; color: var(--ink-soft); padding: 8px 14px; border-radius: 2px; font-size: 13px; transition: all 0.15s; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .btn-ghost:hover { color: var(--ink); background: var(--paper-deep); }

        .input { background: transparent; border: none; border-bottom: 1px solid var(--line); padding: 8px 0; font-family: inherit; font-size: 15px; color: var(--ink); width: 100%; transition: border-color 0.2s; }
        .input:focus { outline: none; border-bottom-color: var(--ink); }
        .input::placeholder { color: var(--ink-faint); }

        .card { background: var(--paper); border: 1px solid var(--line); padding: 28px; transition: all 0.25s; cursor: pointer; position: relative; display: flex; flex-direction: column; height: 100%; }
        .card:hover { border-color: var(--ink); transform: translateY(-2px); box-shadow: 0 12px 30px -10px rgba(31, 24, 16, 0.15); }
        .card:hover .card-title { color: var(--tomato); }
        .card-title { transition: color 0.2s; }
        .card-media {
          aspect-ratio: 3 / 2;
          overflow: hidden;
          border-bottom: 1px solid var(--line);
          position: relative;
          background: var(--paper-deep);
          flex-shrink: 0;
        }
        .recipe-grid-early .card-media {
          aspect-ratio: 16 / 10;
        }
        @media (min-width: 700px) {
          .recipe-grid.recipe-grid-early {
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .recipe-grid-early .card {
            flex-direction: row;
            align-items: stretch;
            min-height: 0;
          }
          .recipe-grid-early .card-media {
            width: 96px;
            min-width: 96px;
            max-width: 96px;
            aspect-ratio: 1;
            height: 96px;
            align-self: center;
            margin: 12px 0 12px 12px;
            border-bottom: none;
            border-right: 1px solid var(--line);
          }
          .recipe-grid-early .card-media-placeholder {
            padding: 12px 14px;
            align-items: flex-end;
          }
          .recipe-grid-early .card-media-monogram {
            font-size: 30px;
          }
          .recipe-grid-early .card-body {
            padding: 14px 18px 14px 16px;
            justify-content: center;
          }
          .recipe-grid-early .card-title {
            font-size: 1.35rem;
            margin-bottom: 6px !important;
          }
          .recipe-grid-early .shelf-invite {
            min-height: 108px;
            flex-direction: row;
            align-items: center;
            justify-content: flex-start;
            gap: 28px;
            padding: 18px 22px;
          }
          .recipe-grid-early .shelf-invite-body {
            max-width: 36ch;
          }
        }
        .card-media-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: flex-end;
          justify-content: flex-start;
          padding: 18px 20px;
          background:
            linear-gradient(160deg, var(--paper-deep) 0%, #e4d8c4 55%, #dccfb8 100%);
        }
        .card-media-monogram {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          font-weight: 400;
          font-size: clamp(34px, 4.2vw, 48px);
          line-height: 1;
          color: var(--tomato);
          opacity: 0.72;
          user-select: none;
        }
        .card-body {
          padding: 16px 18px 18px;
          position: relative;
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }
        .recipe-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 18px;
        }
        @media (min-width: 640px) {
          .recipe-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
        }
        /* 3-col only once the shelf has enough recipes to fill it */
        @media (min-width: 1100px) {
          .recipe-grid.recipe-grid-roomy { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        .shelf-layout-early {
          display: grid;
          grid-template-columns: 1fr;
          gap: 36px;
          margin-bottom: 8px;
        }
        @media (min-width: 960px) {
          .shelf-layout-early {
            grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
            gap: 40px;
            align-items: start;
          }
        }
        .shelf-aside {
          padding: 4px 0 0;
          border-top: 1px solid var(--line);
        }
        @media (min-width: 960px) {
          .shelf-aside {
            border-top: none;
            border-left: 1px solid var(--line);
            padding: 4px 0 8px 28px;
            position: sticky;
            top: 88px;
            min-height: 280px;
            display: flex;
            flex-direction: column;
          }
        }
        .shelf-aside-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 20px;
        }
        .shelf-aside-list li {
          padding: 0;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--line);
        }
        .shelf-aside-list li:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        .shelf-aside-num {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          font-size: 15px;
          color: var(--tomato);
          display: block;
          margin-bottom: 4px;
        }
        .shelf-aside-title {
          font-family: 'Fraunces', Georgia, serif;
          font-size: 16px;
          font-weight: 400;
          letter-spacing: -0.01em;
          color: var(--ink);
          margin: 0 0 4px;
          line-height: 1.25;
        }
        .shelf-aside-body {
          margin: 0;
          font-size: 13px;
          line-height: 1.55;
          color: var(--ink-soft);
        }
        .shelf-aside-foot {
          margin-top: auto;
          padding-top: 24px;
          font-size: 12px;
          line-height: 1.55;
          color: var(--ink-faint);
          max-width: 28ch;
        }
        .shelf-invite {
          text-align: left;
          background: transparent;
          border: 1px dashed var(--line);
          padding: 22px 20px;
          cursor: pointer;
          transition: border-color 0.25s, background 0.25s;
          width: 100%;
          height: 100%;
          min-height: 180px;
          font-family: inherit;
          color: inherit;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
        }
        .shelf-invite:hover {
          border-color: var(--ink);
          border-style: solid;
          background: var(--paper-deep);
        }
        .shelf-invite:hover .shelf-invite-title { color: var(--tomato); }
        .shelf-invite:focus-visible {
          outline: 2px solid var(--tomato);
          outline-offset: 3px;
        }
        .shelf-invite-kicker {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          font-size: 14px;
          color: var(--tomato);
          margin-bottom: 10px;
        }
        .shelf-invite-title {
          font-family: 'Fraunces', Georgia, serif;
          font-size: 1.35rem;
          font-weight: 400;
          letter-spacing: -0.015em;
          margin: 0 0 8px;
          transition: color 0.2s;
        }
        .shelf-invite-body {
          margin: 0;
          font-size: 13px;
          line-height: 1.55;
          color: var(--ink-soft);
          max-width: 28ch;
        }
        .keep-building {
          margin-top: 40px;
          padding: 32px 0 8px;
          border-top: 1px solid var(--line);
        }
        .keep-building-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 28px;
        }
        @media (min-width: 768px) {
          .keep-building-grid {
            grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
            gap: 40px;
            align-items: end;
          }
        }
        .keep-building-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 18px;
        }
        .keep-building-features {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 12px;
        }
        .keep-building-features li {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 12px;
          align-items: baseline;
          padding-top: 12px;
          border-top: 1px solid var(--line);
        }
        .keep-building-features li:first-child {
          border-top: none;
          padding-top: 0;
        }
        .keep-building-features-num {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          color: var(--tomato);
          font-size: 14px;
        }
        .list-toolbar {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 24px;
          padding: 14px 16px;
          background: var(--paper-deep);
          border: 1px solid var(--line);
        }
        @media (min-width: 768px) {
          .list-toolbar {
            flex-direction: row;
            align-items: center;
            gap: 16px;
          }
        }
        .list-toolbar .input {
          border-bottom-color: transparent;
          padding: 6px 0;
        }
        .list-toolbar .input:focus {
          border-bottom-color: var(--ink);
        }

        /* Empty cookbook — editorial path CTAs (interaction, not marketing cards) */
        .path-card {
          text-align: left;
          background: transparent;
          border: none;
          border-top: 1px solid var(--line);
          padding: 28px 4px 30px;
          cursor: pointer;
          transition: border-color 0.3s, background 0.3s, transform 0.3s, box-shadow 0.3s;
          width: 100%;
          font-family: inherit;
          color: inherit;
          display: block;
          position: relative;
        }
        .path-card:last-child {
          border-bottom: 1px solid var(--line);
        }
        @media (min-width: 640px) {
          .path-card,
          .path-card:last-child {
            border: 1px solid var(--line);
            padding: 32px 28px 34px;
            background: var(--paper);
          }
          .path-card:hover {
            border-color: var(--ink);
            background: var(--paper-deep);
            box-shadow: 0 18px 40px -18px rgba(31, 24, 16, 0.16);
            transform: translateY(-1px);
          }
        }
        .path-card:hover .path-card-title { color: var(--tomato); }
        .path-card:focus-visible {
          outline: 2px solid var(--tomato);
          outline-offset: 3px;
        }
        .path-card-kicker {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          font-weight: 400;
          font-size: 15px;
          color: var(--tomato);
          margin-bottom: 14px;
          display: block;
        }
        .path-card-title { transition: color 0.25s; }
        .path-card-arrow {
          color: var(--ink-faint);
          transition: color 0.25s, transform 0.25s;
          flex-shrink: 0;
        }
        .path-card:hover .path-card-arrow {
          color: var(--tomato);
          transform: translateX(4px);
        }

        .empty-home-hero {
          position: relative;
        }
        .empty-home-hero::after {
          content: '';
          display: block;
          width: 40px;
          height: 1px;
          background: var(--tomato);
          margin-top: 32px;
          opacity: 0.9;
        }

        /* Magazine feature spread — typography-led chapters */
        .feature-spread {
          margin-top: 8px;
        }
        .pull-quote {
          position: relative;
          padding: 36px 0 40px;
          margin-bottom: 8px;
          border-top: 1px solid var(--line);
        }
        .pull-quote-mark {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          font-weight: 300;
          font-size: clamp(3.5rem, 10vw, 5.5rem);
          line-height: 0.8;
          color: var(--tomato);
          opacity: 0.35;
          display: block;
          margin-bottom: 8px;
          user-select: none;
        }
        .pull-quote-text {
          font-family: 'Fraunces', Georgia, serif;
          font-weight: 400;
          font-size: clamp(1.65rem, 3.6vw, 2.35rem);
          line-height: 1.25;
          letter-spacing: -0.02em;
          color: var(--ink);
          max-width: 18ch;
        }
        .pull-quote-aside {
          margin-top: 18px;
          max-width: 36ch;
          font-size: 14px;
          line-height: 1.65;
          color: var(--ink-soft);
        }
        @media (min-width: 768px) {
          .pull-quote {
            display: grid;
            grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
            gap: 40px 48px;
            align-items: end;
            padding: 44px 0 48px;
          }
          .pull-quote-aside {
            margin-top: 0;
            padding-bottom: 6px;
          }
        }

        .feature-chapters {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0;
          border-top: 1px solid var(--line);
        }
        .feature-chapter {
          padding: 28px 0 30px;
          border-bottom: 1px solid var(--line);
          opacity: 0;
          animation: chapterIn 0.55s ease-out forwards;
        }
        .feature-chapter:nth-child(1) { animation-delay: 0.08s; }
        .feature-chapter:nth-child(2) { animation-delay: 0.14s; }
        .feature-chapter:nth-child(3) { animation-delay: 0.2s; }
        .feature-chapter:nth-child(4) { animation-delay: 0.26s; }
        .feature-chapter:nth-child(5) { animation-delay: 0.32s; }
        @keyframes chapterIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .feature-chapter {
            opacity: 1;
            animation: none;
          }
        }
        @media (min-width: 768px) {
          .feature-chapters {
            grid-template-columns: 1.25fr 0.9fr;
            column-gap: 48px;
          }
          .feature-chapter {
            padding: 32px 0 34px;
          }
          .feature-chapter--lead {
            grid-column: 1 / -1;
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            gap: 28px 40px;
            align-items: start;
            padding-top: 40px;
            padding-bottom: 44px;
          }
          .feature-chapter--lead .feature-chapter-body {
            max-width: 44ch;
          }
          .feature-chapter--span {
            grid-column: 1 / -1;
            max-width: 52ch;
            padding-top: 36px;
            padding-bottom: 36px;
          }
          .feature-chapter--close {
            grid-column: 1 / -1;
            display: grid;
            grid-template-columns: auto minmax(0, 1fr);
            gap: 20px 32px;
            align-items: baseline;
            padding-top: 36px;
            padding-bottom: 8px;
            border-bottom: none;
          }
          .feature-chapter--close .feature-chapter-body {
            max-width: 48ch;
          }
        }
        .feature-chapter-num {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          font-weight: 400;
          font-size: 20px;
          color: var(--tomato);
          line-height: 1;
          margin-bottom: 12px;
        }
        .feature-chapter--lead .feature-chapter-num {
          font-size: clamp(2.5rem, 5vw, 3.25rem);
          margin-bottom: 0;
          padding-top: 4px;
        }
        .feature-chapter-title {
          font-family: 'Fraunces', Georgia, serif;
          font-weight: 400;
          font-size: 1.35rem;
          letter-spacing: -0.015em;
          line-height: 1.2;
          margin-bottom: 10px;
          color: var(--ink);
        }
        .feature-chapter--lead .feature-chapter-title {
          font-size: clamp(1.6rem, 3vw, 2rem);
          margin-bottom: 14px;
        }
        .feature-chapter-body {
          font-size: 14px;
          line-height: 1.65;
          color: var(--ink-soft);
          max-width: 34ch;
        }

        .keep-building-note {
          margin-top: 22px;
          padding-top: 20px;
          border-top: 1px dashed var(--line);
          display: grid;
          gap: 6px;
        }
        @media (min-width: 640px) {
          .keep-building-note {
            grid-template-columns: auto 1fr;
            gap: 16px 28px;
            align-items: baseline;
          }
        }
        .keep-building-note-label {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic;
          font-size: 15px;
          color: var(--tomato);
        }

        .tag-chip { display: inline-flex; align-items: center; padding: 5px 11px; border: 1px solid var(--line); border-radius: 2px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-soft); background: transparent; cursor: pointer; transition: all 0.15s; font-family: inherit; }
        .tag-chip:hover { border-color: var(--ink-soft); color: var(--ink); }
        .tag-chip.active { background: var(--ink); color: var(--paper); border-color: var(--ink); }

        .pantry-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 100px; font-size: 13px; background: var(--ink); color: var(--paper); }
        .pantry-chip button { background: transparent; border: none; color: var(--paper); opacity: 0.6; cursor: pointer; padding: 0; display: flex; }
        .pantry-chip button:hover { opacity: 1; }

        .nav-link { font-family: 'DM Sans', sans-serif; font-size: 13px; letter-spacing: 0.05em; color: var(--ink-faint); cursor: pointer; padding: 6px 0; border: none; background: transparent; transition: color 0.2s; position: relative; }
        .nav-link:hover { color: var(--ink-soft); }
        .nav-link.active { color: var(--ink); }
        .nav-link.active::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px; background: var(--tomato); }

        /* Mobile icon row under the wordmark — larger glyphs, real tap targets */
        .nav-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          min-width: 44px;
          min-height: 44px;
          padding: 10px 12px;
          color: var(--ink-faint);
          cursor: pointer;
          border: none;
          background: transparent;
          transition: color 0.2s;
          position: relative;
          font-family: 'DM Sans', sans-serif;
          -webkit-tap-highlight-color: transparent;
        }
        .nav-icon:hover { color: var(--ink-soft); }
        .nav-icon.active { color: var(--ink); }
        .nav-icon.active::after { content: ''; position: absolute; bottom: 4px; left: 10px; right: 10px; height: 1px; background: var(--tomato); }
        .nav-icon .nav-count {
          font-size: 12px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.02em;
          line-height: 1;
          color: var(--tomato);
        }

        .divider-fancy { display: flex; align-items: center; gap: 16px; color: var(--ink-faint); }
        .divider-fancy::before, .divider-fancy::after { content: ''; flex: 1; height: 1px; background: var(--line); }

        .checkbox { width: 18px; height: 18px; border: 1px solid var(--line); border-radius: 2px; cursor: pointer; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; transition: all 0.15s; }
        .checkbox.checked { background: var(--ink); border-color: var(--ink); color: var(--paper); }
        .checkbox:hover { border-color: var(--ink-soft); }

        @keyframes fadein { from { opacity: 0.55; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .fadein { animation: fadein 0.35s ease-out; }
        .stagger > * { animation: fadein 0.4s ease-out backwards; }
        .stagger > *:nth-child(1) { animation-delay: 0.05s; }
        .stagger > *:nth-child(2) { animation-delay: 0.1s; }
        .stagger > *:nth-child(3) { animation-delay: 0.15s; }
        .stagger > *:nth-child(4) { animation-delay: 0.2s; }
        .stagger > *:nth-child(5) { animation-delay: 0.25s; }
        .stagger > *:nth-child(n+6) { animation-delay: 0.3s; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .spinning { animation: spin 1s linear infinite; }

        .cook-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; flex: 1; }
        .cook-sidebar { display: none; }
        .cook-ingredients-toggle { display: inline-flex; }
        @media (min-width: 768px) {
          .cook-grid { grid-template-columns: 280px minmax(0, 1fr); }
          .cook-sidebar { display: block; }
          .cook-ingredients-toggle { display: none; }
        }

        @keyframes pulse-warn {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .pulse-dot { animation: pulse-dot 1.2s ease-in-out infinite; }

        /* Ingredient swap affordance — sits inline after each ingredient */
        .ing-row .ing-swap {
          opacity: 0.55;
          background: var(--paper-deep);
        }
        .ing-row .ing-swap:hover:not(:disabled) {
          opacity: 1;
          color: var(--tomato) !important;
          background: rgba(179, 74, 44, 0.08);
        }
        @media (hover: hover) {
          .ing-row .ing-swap { opacity: 0.45; background: transparent; }
          .ing-row:hover .ing-swap { opacity: 0.85; background: var(--paper-deep); }
          .ing-row .ing-swap:hover:not(:disabled) { opacity: 1; background: rgba(179, 74, 44, 0.1); }
        }

        @media print {
          @page { margin: 0.6in; }
          body { background: white !important; color: black !important; }
          .recipe-app { background: white !important; }
          .grain, .no-print, nav { display: none !important; }
          .display { color: black !important; }
          .label { color: #555 !important; }
          .card { break-inside: avoid; box-shadow: none !important; border: 1px solid #ddd !important; }
          a { color: black !important; text-decoration: none !important; }
          img { max-height: 2.5in !important; }
        }
      `}</style>

      <div className="recipe-app">
        <div className="grain" />
        <div className="relative" style={{ zIndex: 1 }}>
          {showTopNav && (
            <TopNav
              view={view}
              setView={setView}
              recipeCount={recipes.length}
              shoppingCount={shoppingList.recipes?.length || 0}
              journalCount={allCookLog.length}
              planCount={thisWeekMealCount}
              plan={plan}
            />
          )}

          {view === 'settings' && (
            <SettingsView
              plan={plan}
              recipeCount={recipes.length}
              userSubs={userSubs}
              onAddUserSub={addUserSub}
              onUpdateUserSub={updateUserSub}
              onRemoveUserSub={removeUserSub}
              prefs={prefs}
              onUpdatePrefs={updatePrefs}
              onChangeTier={changeTier}
              onClose={() => setView('cookbook')}
              onShowUpgrade={() => setUpgradePrompt({ feature: null, check: null })}
            />
          )}

          {view === 'cookbook' && (
            <ListView
              recipes={filtered}
              allRecipes={recipes}
              loading={loading}
              search={search}
              setSearch={setSearch}
              activeTag={activeTag}
              setActiveTag={setActiveTag}
              activeCollection={activeCollection}
              setActiveCollection={setActiveCollection}
              favoritesOnly={favoritesOnly}
              setFavoritesOnly={setFavoritesOnly}
              favoritesCount={recipes.filter(r => r.favorite).length}
              usedTags={usedTags}
              allCollections={allCollections}
              pantryIngredients={pantryIngredients}
              setPantryIngredients={setPantryIngredients}
              pantry={pantry}
              onAddPantry={addPantryItem}
              onRemovePantry={removePantryItem}
              onClearPantry={clearPantry}
              onAdd={(mode = 'url') => { setAddInitialMode(mode); setView('add'); }}
              onOpen={(r) => { setActiveRecipe(r.recipe || r); setView('detail'); }}
              onToggleFavorite={async (recipe) => {
                const updated = { ...recipe, favorite: !recipe.favorite, updated_at: Date.now() };
                await storage.save(updated);
                await refresh();
              }}
            />
          )}

          {view === 'shopping' && (
            <ShoppingView
              shoppingList={shoppingList}
              setShoppingList={setShoppingList}
              recipes={recipes}
              plan={plan}
              requireFeature={requireFeature}
              bumpUsage={bumpUsage}
              pantry={pantry}
              onMoveToPantry={moveCheckedShoppingToPantry}
              onOpenRecipe={(r) => { setActiveRecipe(r); setView('detail'); }}
              onBackToCookbook={() => setView('cookbook')}
            />
          )}

          {view === 'journal' && (
            <JournalView
              entries={allCookLog}
              recipes={recipes}
              onOpenRecipe={(id) => {
                const r = recipes.find(x => x.id === id);
                if (r) { setActiveRecipe(r); setView('detail'); }
              }}
              onBackToCookbook={() => setView('cookbook')}
            />
          )}

          {view === 'plan' && (
            <PlanView
              mealPlan={mealPlan}
              setMealPlan={setMealPlan}
              recipes={recipes}
              shoppingList={shoppingList}
              setShoppingList={setShoppingList}
              plan={plan}
              requireFeature={requireFeature}
              onOpenRecipe={(r) => { setActiveRecipe(r); setView('detail'); }}
              onLogCooked={async (recipeId, date, note) => {
                const r = recipes.find(x => x.id === recipeId);
                if (!r) return;
                const entry = {
                  id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  date: new Date(date + 'T12:00:00').getTime(),
                  note: note || '',
                  photo: null
                };
                const updated = {
                  ...r,
                  cook_log: [entry, ...(r.cook_log || [])],
                  updated_at: Date.now()
                };
                await storage.save(updated);
                await refresh();
              }}
            />
          )}

          {view === 'add' && (
            <AddView
              key={addInitialMode}
              initialMode={addInitialMode}
              plan={plan}
              recipeCount={recipes.length}
              requireFeature={requireFeature}
              bumpUsage={bumpUsage}
              allRecipes={recipes}
              onViewRecipe={(id) => {
                const r = recipes.find(x => x.id === id);
                if (r) { setActiveRecipe(r); setView('detail'); }
              }}
              onCancel={() => { setAddInitialMode('url'); setView('cookbook'); }}
              onSaved={async () => { setAddInitialMode('url'); await refresh(); setView('cookbook'); }}
            />
          )}
          {view === 'detail' && activeRecipe && (
            <DetailView
              recipe={activeRecipe}
              plan={plan}
              requireFeature={requireFeature}
              bumpUsage={bumpUsage}
              shoppingList={shoppingList}
              userSubs={userSubs}
              onAddUserSub={addUserSub}
              onRemoveUserSub={removeUserSub}
              prefs={prefs}
              onAddToShopping={async (entry) => {
                const existing = shoppingList.recipes.filter(r => r.id !== entry.id);
                const next = {
                  ...shoppingList,
                  recipes: [...existing, entry],
                  generated_at: null
                };
                await storage.saveShoppingList(next);
                setShoppingList(next);
              }}
              onBack={() => setView('cookbook')}
              onEdit={() => setView('edit')}
              onDelete={() => {
                // Soft-delete: hide from UI and remove from storage after 6s.
                // Undo toast lets the user recover. No confirm dialog — those
                // are unreliable in iframes and the undo pattern is friendlier.
                const recipeToDelete = activeRecipe;
                const timeoutId = setTimeout(async () => {
                  await storage.remove(recipeToDelete.id);
                  await refresh();
                  setPendingDelete(null);
                }, 6000);
                setPendingDelete({ recipe: recipeToDelete, timeoutId });
                setView('cookbook');
              }}
              onCookMode={() => setView('cook')}
              onRecipeUpdate={(updated) => {
                setActiveRecipe(updated);
                refresh();
              }}
            />
          )}
          {view === 'edit' && activeRecipe && (
            <EditView
              recipe={activeRecipe}
              allRecipes={recipes}
              onViewRecipe={(id) => {
                const r = recipes.find(x => x.id === id);
                if (r) { setActiveRecipe(r); setView('detail'); }
              }}
              onCancel={() => setView('detail')}
              onSaved={async (updated) => {
                await refresh();
                setActiveRecipe(updated);
                setView('detail');
              }}
            />
          )}
          {view === 'cook' && activeRecipe && (
            <CookMode
              recipe={activeRecipe}
              onExit={() => setView('detail')}
            />
          )}
        </div>

        {/* Undo toast */}
        {pendingDelete && (
          <div
            className="fadein"
            style={{
              position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
              background: 'var(--ink)', color: 'var(--paper)',
              padding: '12px 16px 12px 20px',
              display: 'flex', alignItems: 'center', gap: 16,
              borderRadius: 4,
              boxShadow: '0 12px 32px -8px rgba(0,0,0,0.4)',
              zIndex: 200,
              maxWidth: 'calc(100vw - 32px)'
            }}
          >
            <Trash2 size={14} style={{ flexShrink: 0 }} />
            <span className="text-sm" style={{ flex: 1, minWidth: 0 }}>
              Deleted "<span style={{ fontStyle: 'italic' }}>{pendingDelete.recipe.title}</span>"
            </span>
            <button
              onClick={() => {
                clearTimeout(pendingDelete.timeoutId);
                setPendingDelete(null);
              }}
              style={{
                background: 'transparent',
                color: 'var(--paper)',
                border: '1px solid rgba(244, 237, 224, 0.35)',
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 2,
                fontFamily: 'inherit'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(244, 237, 224, 0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              Undo
            </button>
          </div>
        )}

        {/* Upgrade modal */}
        {upgradePrompt && (
          <UpgradeModal
            feature={upgradePrompt.feature}
            check={upgradePrompt.check}
            currentTier={plan.tier}
            onClose={() => setUpgradePrompt(null)}
            onUpgrade={async (newTier) => {
              await changeTier(newTier);
              setUpgradePrompt(null);
            }}
          />
        )}

        {/* First-run onboarding */}
        {showOnboarding && (
          <OnboardingModal
            onDismiss={dismissOnboarding}
            onAddRecipe={() => { dismissOnboarding(); setAddInitialMode('url'); setView('add'); }}
          />
        )}
      </div>
    </>
  );
}

// ---------- Top Nav ----------
function TopNav({ view, setView, recipeCount, shoppingCount, journalCount, planCount, plan }) {
  return (
    <nav className="border-b" style={{ borderColor: 'var(--line)', position: 'sticky', top: 0, background: 'var(--paper)', zIndex: 10, backdropFilter: 'blur(6px)' }}>
      <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <button
            onClick={() => setView('cookbook')}
            className="display text-2xl"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)', fontWeight: 400, padding: 0 }}
          >
            salt <span style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>&amp;</span> page<span style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>.</span>
          </button>
          <div className="hidden md:flex items-center gap-6">
            <button className={`nav-link ${view === 'cookbook' ? 'active' : ''}`} onClick={() => setView('cookbook')}>
              Cookbook
            </button>
            <button className={`nav-link ${view === 'plan' ? 'active' : ''}`} onClick={() => setView('plan')}>
              Plan {planCount > 0 && <span style={{ marginLeft: 4, color: 'var(--tomato)' }}>· {planCount}</span>}
            </button>
            <button className={`nav-link ${view === 'shopping' ? 'active' : ''}`} onClick={() => setView('shopping')}>
              Shopping {shoppingCount > 0 && <span style={{ marginLeft: 4, color: 'var(--tomato)' }}>· {shoppingCount}</span>}
            </button>
            <button className={`nav-link ${view === 'journal' ? 'active' : ''}`} onClick={() => setView('journal')}>
              Journal {journalCount > 0 && <span style={{ marginLeft: 4, color: 'var(--ink-faint)' }}>· {journalCount}</span>}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {plan && (
            <button
              onClick={() => setView('settings')}
              className="flex items-center gap-2"
              style={{
                background: plan.tier === 'free' ? 'var(--paper-deep)' : 'var(--ink)',
                color: plan.tier === 'free' ? 'var(--ink)' : 'var(--paper)',
                border: plan.tier === 'free' ? '1px solid var(--line)' : 'none',
                padding: '6px 12px',
                fontSize: 12,
                letterSpacing: '0.05em',
                cursor: 'pointer',
                borderRadius: 100,
                fontFamily: 'inherit',
                transition: 'all 0.2s'
              }}
              title="Account & plan"
              onMouseEnter={e => {
                if (plan.tier === 'free') {
                  e.currentTarget.style.background = 'var(--ink)';
                  e.currentTarget.style.color = 'var(--paper)';
                }
              }}
              onMouseLeave={e => {
                if (plan.tier === 'free') {
                  e.currentTarget.style.background = 'var(--paper-deep)';
                  e.currentTarget.style.color = 'var(--ink)';
                }
              }}
            >
              {plan.tier !== 'free' && <Sparkles size={11} />}
              <span style={{ fontWeight: 500 }}>{PLAN_DETAILS[plan.tier]?.name || 'Free'}</span>
            </button>
          )}
          <button
            onClick={() => setView('settings')}
            className={`nav-link ${view === 'settings' ? 'active' : ''}`}
            style={{ padding: 8 }}
            title="Settings & demo mode"
          >
            <SettingsIcon size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      {/* Mobile nav row — larger icons + ~44px tap targets under the wordmark */}
      <div className="md:hidden flex items-center gap-0.5 px-5 pb-1.5">
        <button className={`nav-icon ${view === 'cookbook' ? 'active' : ''}`} onClick={() => setView('cookbook')} title="Cookbook" aria-label="Cookbook">
          <BookOpen size={20} strokeWidth={1.75} />
        </button>
        <button className={`nav-icon ${view === 'plan' ? 'active' : ''}`} onClick={() => setView('plan')} title="Plan" aria-label="Plan">
          <CalendarDays size={20} strokeWidth={1.75} />
          {planCount > 0 && <span className="nav-count">{planCount}</span>}
        </button>
        <button className={`nav-icon ${view === 'shopping' ? 'active' : ''}`} onClick={() => setView('shopping')} title="Shopping" aria-label="Shopping">
          <ShoppingBasket size={20} strokeWidth={1.75} />
          {shoppingCount > 0 && <span className="nav-count">{shoppingCount}</span>}
        </button>
        <button className={`nav-icon ${view === 'journal' ? 'active' : ''}`} onClick={() => setView('journal')} title="Journal" aria-label="Journal">
          <History size={20} strokeWidth={1.75} />
        </button>
      </div>
    </nav>
  );
}

// ---------- List View ----------
function ListView({ recipes, allRecipes, loading, search, setSearch, activeTag, setActiveTag, activeCollection, setActiveCollection, favoritesOnly, setFavoritesOnly, favoritesCount, usedTags, allCollections, pantryIngredients, setPantryIngredients, pantry, onAddPantry, onRemovePantry, onClearPantry, onAdd, onOpen, onToggleFavorite }) {
  const [pantryInput, setPantryInput] = useState('');
  const [pantryOpen, setPantryOpen] = useState(pantryIngredients.length > 0 || (pantry?.items?.length || 0) > 0);

  const isPantryMode = pantryIngredients.length > 0 || (pantry?.items?.length || 0) > 0;
  const persistentCount = pantry?.items?.length || 0;
  const isEmptyCookbook = !loading && allRecipes.length === 0;
  const hasActiveFilters = !!search || !!activeTag || !!activeCollection || isPantryMode || favoritesOnly;

  // Zero-recipe home: hide search / pantry / filter scaffolding so the page
  // doesn't read as an unfinished list shell over a void.
  if (isEmptyCookbook) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-12 md:py-20">
        <EmptyCookbookHome onAddUrl={() => onAdd('url')} onAddManual={() => onAdd('manual')} />
        <footer className="mt-16 md:mt-20 pt-8" style={{ borderTop: '1px solid var(--line)' }}>
          <p className="label text-center">Private by default · saved on this device</p>
        </footer>
      </div>
    );
  }

  const isEarlyShelf = allRecipes.length > 0 && allRecipes.length < 6;
  const showShelfInvite = isEarlyShelf && !hasActiveFilters;

  return (
    <div className="max-w-6xl mx-auto px-8 py-12">
      <header className="flex items-end justify-between gap-6 mb-10 fadein flex-wrap">
        <div className="min-w-0" style={{ maxWidth: '38rem' }}>
          <div className="label mb-2">№ {String(allRecipes.length).padStart(3, '0')} · Cookbook</div>
          <h1 className="display text-4xl md:text-5xl font-light leading-none mb-3">
            {isPantryMode ? <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>What can I make?</em> : 'Every recipe, in one place'}
          </h1>
          {!isPantryMode && (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-soft)', maxWidth: '42ch' }}>
              Your shelf — extracted clean, scaled without nonsense, ready for cook mode when dinner starts.
            </p>
          )}
        </div>
        <button className="btn-primary" onClick={() => onAdd('url')}>
          <Plus size={16} /> New recipe
        </button>
      </header>

      <div className="list-toolbar">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Search size={16} style={{ color: 'var(--ink-soft)', flexShrink: 0 }} />
          <input
            className="input"
            placeholder="Search titles, ingredients, steps…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search cookbook"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {favoritesCount > 0 && (
            <button
              className="btn-ghost"
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              style={{ color: favoritesOnly ? 'var(--tomato)' : 'var(--ink-soft)' }}
            >
              <Star size={14} fill={favoritesOnly ? 'currentColor' : 'none'} />
              Favorites {favoritesOnly && `(${favoritesCount})`}
            </button>
          )}
          <button
            className="btn-ghost"
            onClick={() => setPantryOpen(!pantryOpen)}
            style={{
              color: pantryOpen || isPantryMode ? 'var(--ink)' : 'var(--ink-soft)',
              background: pantryOpen || isPantryMode ? 'var(--paper)' : 'transparent',
              border: '1px solid var(--line)'
            }}
          >
            <Refrigerator size={14} /> Pantry {persistentCount > 0 && <span style={{ color: 'var(--tomato)', marginLeft: 2 }}>· {persistentCount}</span>}
          </button>
        </div>
      </div>

      {pantryOpen && (
        <div className="mb-8 p-5 fadein" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <div>
              <p className="label flex items-center gap-2">
                <Refrigerator size={11} /> Your pantry
                {persistentCount > 0 && <span style={{ color: 'var(--ink-faint)' }}>· {persistentCount} stocked</span>}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
                Saved between sessions. Recipes that match get matched automatically.
              </p>
            </div>
            {persistentCount > 0 && onClearPantry && (
              <button onClick={onClearPantry} className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--ink-faint)' }}>
                Clear pantry
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            {/* Persistent items */}
            {(pantry?.items || []).map(it => (
              <span key={it.id} className="pantry-chip" title={it.from_shopping ? 'Restocked from shopping list' : ''}>
                {it.name}
                <button onClick={() => onRemovePantry(it.id)}><X size={11} /></button>
              </span>
            ))}
            {/* Session-only chips (visually distinct — temporary) */}
            {pantryIngredients.map((ing, i) => (
              <span
                key={`s-${i}`}
                className="pantry-chip"
                style={{ background: 'var(--paper-deep)', color: 'var(--ink-soft)', border: '1px dashed var(--ink-faint)' }}
                title="Session-only — not saved to pantry"
              >
                {ing}
                <button onClick={() => setPantryIngredients(pantryIngredients.filter((_, idx) => idx !== i))}>
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              className="input"
              style={{ width: 'auto', minWidth: 200, flex: 1 }}
              placeholder={persistentCount === 0 ? 'chicken, lemon, garlic… (Enter saves to pantry)' : 'add to pantry…'}
              value={pantryInput}
              onChange={e => setPantryInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  if (pantryInput.trim()) {
                    onAddPantry(pantryInput.trim());
                    setPantryInput('');
                  }
                } else if (e.key === 'Backspace' && !pantryInput) {
                  // Remove last persistent item
                  if (pantry?.items?.length > 0) {
                    onRemovePantry(pantry.items[pantry.items.length - 1].id);
                  }
                }
              }}
            />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              Press Enter or comma to add. Pantry items persist; <span style={{ borderBottom: '1px dashed var(--ink-faint)' }}>dashed chips</span> are session-only.
            </p>
            {pantryIngredients.length > 0 && (
              <button
                onClick={() => {
                  pantryIngredients.forEach(name => onAddPantry(name));
                  setPantryIngredients([]);
                }}
                className="btn-ghost"
                style={{ padding: '4px 10px', fontSize: 11 }}
              >
                Save session items to pantry →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Collections row */}
      {allCollections.length > 0 && !isPantryMode && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen size={11} style={{ color: 'var(--ink-faint)' }} />
            <span className="label">Collections</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={`tag-chip ${!activeCollection ? 'active' : ''}`}
              onClick={() => setActiveCollection(null)}
            >all</button>
            {allCollections.map(c => (
              <button
                key={c}
                className={`tag-chip ${activeCollection === c ? 'active' : ''}`}
                onClick={() => setActiveCollection(activeCollection === c ? null : c)}
              >{c}</button>
            ))}
          </div>
        </div>
      )}

      {/* Diet tags row */}
      {usedTags.length > 0 && !isPantryMode && (
        <div className="mb-8">
          <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="label">Diet</span>
            </div>
            <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>Filter the shelf by how you cook</p>
          </div>
          <div className="flex flex-wrap gap-2" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            <button
              className={`tag-chip ${!activeTag ? 'active' : ''}`}
              onClick={() => setActiveTag(null)}
            >all</button>
            {usedTags.map(tag => (
              <button
                key={tag}
                className={`tag-chip ${activeTag === tag ? 'active' : ''}`}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              >{tag}</button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20" style={{ color: 'var(--ink-faint)' }}>
          <Loader2 className="spinning mx-auto mb-3" size={20} />
          <p className="label">Loading the cookbook</p>
        </div>
      ) : recipes.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters} onAdd={() => onAdd('url')} pantryMode={isPantryMode} />
      ) : (
        <>
          <div className={isEarlyShelf && !hasActiveFilters ? 'shelf-layout-early' : undefined}>
            <div className={`recipe-grid stagger${allRecipes.length >= 6 ? ' recipe-grid-roomy' : ' recipe-grid-early'}`}>
              {recipes.map(item => {
                const recipe = item.recipe || item;
                const matchCount = item.matchCount;
                return (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    matchCount={matchCount}
                    pantrySize={pantryIngredients.length}
                    onClick={() => onOpen(recipe)}
                    onToggleFavorite={onToggleFavorite}
                  />
                );
              })}
              {showShelfInvite && (
                <button
                  type="button"
                  className="shelf-invite fadein"
                  onClick={() => onAdd('url')}
                  aria-label="Paste a URL to add another recipe"
                >
                  <span className="shelf-invite-kicker">Next on the shelf</span>
                  <span className="shelf-invite-title">Paste another URL</span>
                  <p className="shelf-invite-body">
                    Skip the life story. Keep the recipe — then cook, scale, or shop from here.
                  </p>
                </button>
              )}
            </div>

            {isEarlyShelf && !hasActiveFilters && (
              <aside className="shelf-aside fadein" aria-label="Inside this kitchen">
                <div className="label mb-4">Inside this kitchen</div>
                <ul className="shelf-aside-list">
                  <li>
                    <span className="shelf-aside-num">01</span>
                    <h3 className="shelf-aside-title">Cook mode</h3>
                    <p className="shelf-aside-body">Big type, timers, screen awake at the stove.</p>
                  </li>
                  <li>
                    <span className="shelf-aside-num">02</span>
                    <h3 className="shelf-aside-title">Kitchen-real scale</h3>
                    <p className="shelf-aside-body">Halve or double with fractions that still cook.</p>
                  </li>
                  <li>
                    <span className="shelf-aside-num">03</span>
                    <h3 className="shelf-aside-title">Shop &amp; pantry</h3>
                    <p className="shelf-aside-body">List from recipes. Dinner from what’s on hand.</p>
                  </li>
                </ul>
                <p className="shelf-aside-foot">
                  Open any card to cook. The feed stays elsewhere.
                </p>
              </aside>
            )}
          </div>

          {isEarlyShelf && !hasActiveFilters && (
            <section className="keep-building fadein" aria-label="Keep building your cookbook">
              <div className="keep-building-grid">
                <div>
                  <div className="label mb-2">Keep building</div>
                  <p className="display text-2xl md:text-3xl font-light mb-2" style={{ color: 'var(--ink)' }}>
                    A cookbook grows one recipe at a time.
                  </p>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-soft)', maxWidth: '40ch' }}>
                    Paste a URL or write one in by hand. Both land on this shelf — private on this device, ready when dinner starts.
                  </p>
                  <div className="keep-building-actions">
                    <button type="button" className="btn-primary" onClick={() => onAdd('url')}>
                      <LinkIcon size={14} /> Paste a URL
                    </button>
                    <button type="button" className="btn-ghost" style={{ border: '1px solid var(--line)' }} onClick={() => onAdd('manual')}>
                      <Edit3 size={14} /> Add by hand
                    </button>
                  </div>
                </div>
                <ul className="keep-building-features" aria-label="What you can do once a recipe is saved">
                  <li>
                    <span className="keep-building-features-num">Cook</span>
                    <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>Open any card into cook mode — type you can read across the counter.</span>
                  </li>
                  <li>
                    <span className="keep-building-features-num">Scale</span>
                    <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>Adjust servings without decimal flour. Kitchen fractions only.</span>
                  </li>
                  <li>
                    <span className="keep-building-features-num">Share</span>
                    <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>Send a recipe cookbook-to-cookbook when a friend asks for it.</span>
                  </li>
                </ul>
              </div>
            </section>
          )}
        </>
      )}

      <footer className="mt-14 md:mt-16 pt-8" style={{ borderTop: '1px solid var(--line)' }}>
        <p className="label text-center">Saved locally · {allRecipes.length} {allRecipes.length === 1 ? 'recipe' : 'recipes'}</p>
      </footer>
    </div>
  );
}

const EMPTY_HOME_CHAPTERS = [
  {
    num: '01',
    title: 'Cook mode, built for the stove',
    body: 'Big type you can read across the counter. Timers that stay with you. A screen that refuses to sleep mid-sauce.',
    lead: true
  },
  {
    num: '02',
    title: 'Scale that still looks like a recipe',
    body: 'Halve a stew, double a bake — fractions stay kitchen-real. No 0.375 cups of flour staring back at you.'
  },
  {
    num: '03',
    title: 'Shop from the shelf',
    body: 'Pull a shopping list from the recipes you’re actually making. One aisle-minded list, not five open tabs.'
  },
  {
    num: '04',
    title: 'Open the pantry, ask dinner',
    body: 'Stock what’s on hand. See what you can make tonight — ranked by what matches, not what trends.',
    span: true
  },
  {
    num: '05',
    title: 'Yours, on this device',
    body: 'Private by default. Recipes live locally to start — no account wall between you and the first page.',
    close: true
  }
];

function EmptyCookbookHome({ onAddUrl, onAddManual }) {
  return (
    <div className="fadein">
      <header className="empty-home-hero mb-12 md:mb-16 max-w-2xl">
        <div className="label mb-5">Your cookbook</div>
        <h1
          className="leading-none mb-6"
          style={{
            fontFamily: 'Fraunces, Georgia, serif',
            fontWeight: 400,
            fontSize: 'clamp(2.85rem, 7.2vw, 4.5rem)',
            letterSpacing: '-0.025em',
            color: 'var(--ink)'
          }}
        >
          salt <span style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>&amp;</span> page
          <span style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>.</span>
        </h1>
        <p
          className="display text-xl md:text-2xl font-light leading-snug"
          style={{ color: 'var(--ink-soft)', maxWidth: '26ch' }}
        >
          A quiet cookbook for people who cook —{' '}
          <em style={{ color: 'var(--ink)', fontStyle: 'italic', fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400 }}>
            not another recipe feed
          </em>
          .
        </p>
      </header>

      <section className="mb-16 md:mb-20" aria-label="Start your cookbook">
        <div className="label mb-5">Begin with</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 sm:gap-5 stagger">
          <button type="button" className="path-card" onClick={onAddUrl}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="path-card-kicker">From the web</span>
                <div className="path-card-title display text-2xl md:text-3xl mb-3" style={{ fontWeight: 400 }}>
                  Paste a URL
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-soft)', maxWidth: '32ch' }}>
                  From any food blog. We skip the life story and keep the recipe — ingredients, steps, the photo if it’s honest.
                </p>
              </div>
              <ChevronRight size={18} className="path-card-arrow" style={{ marginTop: 2 }} aria-hidden="true" />
            </div>
          </button>

          <button type="button" className="path-card" onClick={onAddManual}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="path-card-kicker">From memory</span>
                <div className="path-card-title display text-2xl md:text-3xl mb-3" style={{ fontWeight: 400 }}>
                  Add by hand
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-soft)', maxWidth: '32ch' }}>
                  Grandma’s card, a napkin scrawl, the dish you finally wrote down. Typed in, kept like paper.
                </p>
              </div>
              <ChevronRight size={18} className="path-card-arrow" style={{ marginTop: 2 }} aria-hidden="true" />
            </div>
          </button>
        </div>
      </section>

      <section className="feature-spread" aria-label="Inside the cookbook">
        <div className="label mb-2">Inside the kitchen</div>

        <blockquote className="pull-quote">
          <div>
            <span className="pull-quote-mark" aria-hidden="true">“</span>
            <p className="pull-quote-text">
              Built for the counter — not the scroll.
            </p>
          </div>
          <p className="pull-quote-aside">
            Most recipe apps want another save. Salt &amp; page wants the next meal: extract cleanly, cook with confidence, scale without nonsense, shop once, cook again.
          </p>
        </blockquote>

        <div className="feature-chapters">
          {EMPTY_HOME_CHAPTERS.map((ch) => (
            <article
              key={ch.num}
              className={`feature-chapter${ch.lead ? ' feature-chapter--lead' : ''}${ch.span ? ' feature-chapter--span' : ''}${ch.close ? ' feature-chapter--close' : ''}`}
            >
              <div className="feature-chapter-num" aria-hidden="true">{ch.num}</div>
              <div className="feature-chapter-body-wrap">
                <h2 className="feature-chapter-title">{ch.title}</h2>
                <p className="feature-chapter-body" style={{ margin: 0 }}>{ch.body}</p>
              </div>
            </article>
          ))}
        </div>

        <p
          className="text-sm mt-10 leading-relaxed"
          style={{ color: 'var(--ink-faint)', maxWidth: '48ch' }}
        >
          Later: a week’s meal plan, a cook journal, notes and substitutions when a recipe needs your voice —
          all without turning dinner into a dashboard.
        </p>
      </section>
    </div>
  );
}

function EmptyState({ hasFilters, onAdd, pantryMode }) {
  if (pantryMode) {
    return (
      <div className="text-center py-24">
        <Refrigerator className="mx-auto mb-4" size={28} style={{ color: 'var(--ink-faint)' }} />
        <p className="display text-2xl mb-2" style={{ color: 'var(--ink-soft)' }}>Nothing in your cookbook matches.</p>
        <p style={{ color: 'var(--ink-faint)' }}>Try fewer or more common ingredients, or add a new recipe.</p>
      </div>
    );
  }
  if (hasFilters) {
    return (
      <div className="text-center py-24">
        <p className="display text-2xl mb-2" style={{ color: 'var(--ink-soft)' }}>Nothing matches.</p>
        <p style={{ color: 'var(--ink-faint)' }}>Try a different search or clear the filter.</p>
      </div>
    );
  }
  // Fallback if ListView empty-home gate is bypassed
  return (
    <EmptyCookbookHome onAddUrl={onAdd} onAddManual={onAdd} />
  );
}

function RecipeCard({ recipe, onClick, matchCount, pantrySize, onToggleFavorite }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showPhoto = !!(recipe.hero_image && !imgFailed);
  const eyebrow = matchCount != null && !showPhoto
    ? `${matchCount}/${pantrySize} match`
    : formatCardEyebrow(recipe);
  const prep = formatRecipeTime(recipe.prep_time);
  const cook = formatRecipeTime(recipe.cook_time);
  const monogram = (recipe.title || '?').trim().charAt(0).toUpperCase() || '·';
  const hasMetaTimes = !!(prep || cook);

  return (
    <article className="card" onClick={onClick} style={{ padding: 0, overflow: 'hidden' }}>
      <div className="card-media">
        {!showPhoto && (
          <div className="card-media-placeholder" aria-hidden="true">
            <span className="card-media-monogram">{monogram}</span>
          </div>
        )}
        {showPhoto && (
          <img
            src={recipe.hero_image}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.4s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            onError={() => setImgFailed(true)}
          />
        )}
        {matchCount != null && showPhoto && (
          <div style={{ position: 'absolute', top: 12, left: 12, background: 'var(--ink)', color: 'var(--paper)', padding: '4px 10px', fontSize: 11, letterSpacing: '0.05em', borderRadius: 2 }}>
            {matchCount}/{pantrySize} match
          </div>
        )}
        {onToggleFavorite && (
          <button
            onClick={e => { e.stopPropagation(); onToggleFavorite(recipe); }}
            style={{
              position: 'absolute', top: 12, right: 12,
              background: recipe.favorite ? 'var(--tomato)' : (showPhoto ? 'rgba(31, 24, 16, 0.55)' : 'rgba(244, 237, 224, 0.85)'),
              color: recipe.favorite ? 'var(--paper)' : (showPhoto ? 'var(--paper)' : 'var(--ink-soft)'),
              border: showPhoto ? 'none' : '1px solid var(--line)',
              cursor: 'pointer',
              width: 32, height: 32, borderRadius: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(4px)', transition: 'all 0.2s'
            }}
            title={recipe.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star size={14} fill={recipe.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <div className="card-body">
        <div className="flex items-start justify-between mb-3 gap-3">
          <div className="label">{eyebrow}</div>
          <div className="flex items-center gap-2" style={{ color: 'var(--ink-faint)', flexShrink: 0 }}>
            {(recipe.cook_log || []).length > 0 && (
              <span className="text-xs flex items-center gap-1" title={`${recipe.cook_log.length} cook log entries`}>
                <BookOpen size={11} /> {recipe.cook_log.length}
              </span>
            )}
            {recipe.source_url && <LinkIcon size={12} />}
          </div>
        </div>
        <h2 className="display card-title text-xl md:text-2xl leading-tight mb-2" style={{ fontWeight: 400 }}>
          {recipe.title}
        </h2>
        {(recipe.diet_tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {recipe.diet_tags.slice(0, 3).map(t => (
              <span key={t} className="tag-chip" style={{ pointerEvents: 'none' }}>{t}</span>
            ))}
          </div>
        )}
        {hasMetaTimes ? (
          <div className="flex items-center gap-4 text-xs mt-auto pt-1" style={{ color: 'var(--ink-faint)' }}>
            {prep && <span className="flex items-center gap-1"><Clock size={11} />{prep}</span>}
            {cook && <span className="flex items-center gap-1"><ChefHat size={11} />{cook}</span>}
          </div>
        ) : (
          <div className="text-xs mt-auto pt-1" style={{ color: 'var(--ink-faint)' }}>
            {(recipe.ingredients || []).length === 1
              ? '1 ingredient'
              : `${(recipe.ingredients || []).length} ingredients`}
          </div>
        )}
      </div>
    </article>
  );
}

// ---------- Add View ----------
function AddView({ onCancel, onSaved, plan, recipeCount, requireFeature, bumpUsage, allRecipes = [], onViewRecipe, initialMode = 'url' }) {
  const [mode, setMode] = useState(initialMode);
  const [url, setUrl] = useState('');
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  // Social media import state
  const [socialMode, setSocialMode] = useState('url');
  const [socialUrl, setSocialUrl] = useState('');
  const [socialText, setSocialText] = useState('');
  // Shared-code import state
  const [shareCode, setShareCode] = useState('');
  const [decodingShare, setDecodingShare] = useState(false);

  // Recipe-count gate (free tier cap)
  const recipeCapCheck = canSaveAnotherRecipe(plan, recipeCount);
  const atRecipeCap = !recipeCapCheck.allowed;

  // Per-feature usage info
  const urlCheck = canUseFeature(plan, 'url_extract');
  const photoCheck = canUseFeature(plan, 'photo_extract');
  const socialCheck = canUseFeature(plan, 'social_extract');

  const [urlDupe, setUrlDupe] = useState(null); // { recipe } when typed URL matches existing

  // Watch URL changes and detect existing matches as the user types
  useEffect(() => {
    if (!url.trim()) { setUrlDupe(null); return; }
    const candUrl = cleanUrl(url.trim()).toLowerCase();
    const existing = allRecipes.find(r => r.source_url && cleanUrl(r.source_url).toLowerCase() === candUrl);
    setUrlDupe(existing ? { recipe: existing } : null);
  }, [url, allRecipes]);

  const handleScrape = async () => {
    if (!url.trim()) return;
    // If we already have this URL, refuse to spend an AI call — the inline UI
    // gives them a direct "View saved version" button.
    if (urlDupe && onViewRecipe) {
      onViewRecipe(urlDupe.recipe.id);
      return;
    }
    if (!requireFeature('url_extract')) return;
    setScraping(true);
    setError(null);
    try {
      const extracted = await extractRecipeFromUrl(url.trim());
      await bumpUsage('url_extract');
      setDraft({
        ...extracted,
        source_url: url.trim(),
        diet_tags: extracted.diet_tags || []
      });
    } catch (e) {
      setError(e.message || 'Could not extract recipe');
    } finally {
      setScraping(false);
    }
  };

  const handlePhotoUpload = async (file) => {
    if (!file) return;
    setPhotoProcessing(true);
    setError(null);
    try {
      const dataUrl = await compressImage(file, { maxWidth: 1800, quality: 0.85 });
      setPhoto(dataUrl);
    } catch (e) {
      setError('Could not load photo: ' + e.message);
    } finally {
      setPhotoProcessing(false);
    }
  };

  const handlePhotoExtract = async () => {
    if (!photo) return;
    if (!requireFeature('photo_extract')) return;
    setScraping(true);
    setError(null);
    try {
      const extracted = await extractRecipeFromPhoto(photo);
      await bumpUsage('photo_extract');
      setDraft({
        ...extracted,
        hero_image: photo,
        diet_tags: extracted.diet_tags || []
      });
    } catch (e) {
      setError(e.message || 'Could not read recipe from photo');
    } finally {
      setScraping(false);
    }
  };

  const handleSocialExtract = async () => {
    const input = socialMode === 'url' ? socialUrl.trim() : socialText.trim();
    if (!input) return;
    if (!requireFeature('social_extract')) return;
    setScraping(true);
    setError(null);
    try {
      const extracted = await extractRecipeFromSocial(input);
      await bumpUsage('social_extract');
      setDraft({
        ...extracted,
        diet_tags: extracted.diet_tags || []
      });
    } catch (e) {
      setError(e.message || 'Could not extract recipe from social post');
    } finally {
      setScraping(false);
    }
  };

  const handleShareCodeImport = () => {
    if (!shareCode.trim()) return;
    setDecodingShare(true);
    setError(null);
    try {
      const decoded = decodeRecipeFromShare(shareCode);
      // No AI call needed — straight to draft review
      setDraft({
        ...decoded,
        diet_tags: decoded.diet_tags || [],
        notes: decoded.notes
          ? `${decoded.notes}\n\n— Shared with you`
          : '— Shared with you'
      });
    } catch (e) {
      setError(e.message || 'Could not read this code');
    } finally {
      setDecodingShare(false);
    }
  };

  if (draft) {
    return <RecipeForm initial={draft} onCancel={() => setDraft(null)} onSaved={onSaved} title="Review & save" subtitle="Tweak anything that looks off, then save." allRecipes={allRecipes} onViewRecipe={onViewRecipe} />;
  }

  if (mode === 'manual') {
    return <RecipeForm onCancel={onCancel} onSaved={onSaved} title="Add by hand" allRecipes={allRecipes} onViewRecipe={onViewRecipe} />;
  }

  if (mode === 'share_code') {
    return (
      <div className="max-w-2xl mx-auto px-8 py-12 fadein">
        <button className="btn-ghost mb-8" onClick={onCancel}><ArrowLeft size={14} /> Cancel</button>

        <div className="label mb-3">From a friend</div>
        <h1 className="display text-5xl font-light mb-3 leading-tight">Paste a shared <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>code.</em></h1>
        <p className="mb-8" style={{ color: 'var(--ink-soft)' }}>
          A friend sent you a kitchen-share code? Paste it here. The whole recipe — title, ingredients, steps, notes — drops into your cookbook in one click. No AI calls used.
        </p>

        <div className="mb-6">
          <label className="label block mb-3">Shared code</label>
          <textarea
            className="input mono"
            style={{ resize: 'vertical', minHeight: 140, padding: '12px', lineHeight: 1.5, fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}
            placeholder="saltpage-share-v1:eyJ0aXRsZSI6IkVhc3kgS29yZWFu…"
            value={shareCode}
            onChange={e => setShareCode(e.target.value)}
            disabled={decodingShare}
          />
          <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
            Paste exactly what your friend sent — the whole code, including the "saltpage-share-v1:" prefix.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 flex items-start gap-3" style={{ background: 'rgba(179, 74, 44, 0.08)', border: '1px solid rgba(179, 74, 44, 0.3)' }}>
            <AlertCircle size={16} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
            <p className="text-sm" style={{ color: 'var(--tomato-deep)' }}>{error}</p>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="btn-primary"
            onClick={handleShareCodeImport}
            disabled={!shareCode.trim() || decodingShare || atRecipeCap}
          >
            {decodingShare ? <><Loader2 size={14} className="spinning" /> Reading…</> : <><Send size={14} /> Import recipe</>}
          </button>
          <button className="btn-ghost" onClick={() => setMode('url')}>← Back</button>
        </div>
      </div>
    );
  }

  if (mode === 'social') {
    const platformDetected = (() => {
      const u = socialUrl.trim().toLowerCase();
      if (/tiktok\.com/.test(u)) return { name: 'TikTok', color: '#fe2c55' };
      if (/instagram\.com/.test(u)) return { name: 'Instagram', color: '#e1306c' };
      if (/(youtube\.com|youtu\.be)/.test(u)) return { name: 'YouTube', color: '#ff0000' };
      if (/facebook\.com/.test(u)) return { name: 'Facebook', color: '#1877f2' };
      return null;
    })();

    return (
      <div className="max-w-2xl mx-auto px-8 py-12 fadein">
        <button className="btn-ghost mb-8" onClick={onCancel}><ArrowLeft size={14} /> Cancel</button>

        <div className="label mb-3">Step one</div>
        <h1 className="display text-5xl font-light mb-3 leading-tight">From <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>social.</em></h1>
        <p className="mb-8" style={{ color: 'var(--ink-soft)' }}>
          TikTok, Instagram Reels, YouTube Shorts, Facebook. Paste the post link, or copy the caption text and paste that.
        </p>

        {/* Mode tabs */}
        <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--line)' }}>
          <button
            onClick={() => setSocialMode('url')}
            className="nav-link"
            style={{
              padding: '12px 0',
              marginRight: 24,
              color: socialMode === 'url' ? 'var(--ink)' : 'var(--ink-faint)',
              borderBottom: socialMode === 'url' ? '2px solid var(--tomato)' : '2px solid transparent',
              marginBottom: -1,
              fontSize: 13,
              fontWeight: 500
            }}
          >
            Paste a link
          </button>
          <button
            onClick={() => setSocialMode('text')}
            className="nav-link"
            style={{
              padding: '12px 0',
              color: socialMode === 'text' ? 'var(--ink)' : 'var(--ink-faint)',
              borderBottom: socialMode === 'text' ? '2px solid var(--tomato)' : '2px solid transparent',
              marginBottom: -1,
              fontSize: 13,
              fontWeight: 500
            }}
          >
            Paste the caption
          </button>
        </div>

        {socialMode === 'url' ? (
          <>
            <div className="mb-6">
              <label className="label block mb-3 flex items-center gap-2">
                Post URL
                {platformDetected && (
                  <span style={{
                    background: platformDetected.color, color: 'white',
                    padding: '2px 8px', borderRadius: 100, fontSize: 10, letterSpacing: '0.05em'
                  }}>
                    {platformDetected.name}
                  </span>
                )}
              </label>
              <input
                className="input"
                placeholder="https://www.tiktok.com/@chef/video/12345 or https://instagram.com/p/abc..."
                value={socialUrl}
                onChange={e => setSocialUrl(e.target.value)}
                disabled={scraping}
                onKeyDown={e => e.key === 'Enter' && handleSocialExtract()}
              />
              <p className="text-xs mt-3" style={{ color: 'var(--ink-faint)', lineHeight: 1.6 }}>
                We'll search for the post and read the caption, description, or pinned comments. If the recipe is only spoken in the video, switch to <button onClick={() => setSocialMode('text')} style={{ background: 'none', border: 'none', color: 'var(--tomato)', cursor: 'pointer', padding: 0, textDecoration: 'underline', font: 'inherit' }}>"Paste the caption"</button> mode and copy the text directly.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="mb-6">
              <label className="label block mb-3">Caption text</label>
              <textarea
                className="input"
                style={{ resize: 'vertical', minHeight: 200, padding: '8px 0', lineHeight: 1.6, fontFamily: 'inherit' }}
                placeholder={`Paste the caption from the post here. Something like:\n\n"VIRAL COTTAGE CHEESE PASTA 🍝\n\nIngredients:\n- 1 cup cottage cheese\n- 8 oz pasta\n- 2 cloves garlic\n- olive oil\n- salt & pepper\n\nBlend the cottage cheese until smooth, cook pasta…"`}
                value={socialText}
                onChange={e => setSocialText(e.target.value)}
                disabled={scraping}
              />
              <p className="text-xs mt-3" style={{ color: 'var(--ink-faint)', lineHeight: 1.6 }}>
                We'll strip hashtags, emojis, and "save this!" filler. The recipe content gets structured into a clean format.
              </p>
            </div>
          </>
        )}

        {error && (
          <div className="mb-6 p-4 flex items-start gap-3" style={{ background: 'rgba(179, 74, 44, 0.08)', border: '1px solid rgba(179, 74, 44, 0.3)' }}>
            <AlertCircle size={16} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-sm" style={{ color: 'var(--tomato-deep)' }}>{error}</p>
              {error.toLowerCase().includes('caption') && socialMode === 'url' && (
                <button
                  onClick={() => setSocialMode('text')}
                  className="text-xs mt-2"
                  style={{ background: 'none', border: 'none', color: 'var(--tomato)', cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: 'inherit' }}
                >
                  Switch to caption-paste mode →
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button
            className="btn-primary"
            onClick={handleSocialExtract}
            disabled={scraping || (socialMode === 'url' ? !socialUrl.trim() : !socialText.trim()) || atRecipeCap}
          >
            {scraping ? <><Loader2 size={14} className="spinning" /> Reading the post…</> : <><Sparkles size={14} /> Extract recipe</>}
          </button>
          <button className="btn-ghost" onClick={() => setMode('url')}>← Back to URL</button>
        </div>

        <div className="mt-12 p-6" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
          <p className="label mb-3">How this works</p>
          <ul className="text-sm space-y-2" style={{ color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            <li>· <strong>Link mode</strong> — best for posts where the creator typed the recipe in the caption or pinned a comment with it. Works well for Instagram and TikTok creators who spell out ingredients in text.</li>
            <li>· <strong>Caption-paste mode</strong> — works for any post. Open the post, copy the description text, paste it here. We can't transcribe video audio, but if the recipe is written anywhere as text, we can extract it.</li>
            <li>· The creator's @handle gets credited in the recipe notes when we can identify it.</li>
          </ul>
        </div>
      </div>
    );
  }

  if (mode === 'photo') {
    return (
      <div className="max-w-2xl mx-auto px-8 py-12 fadein">
        <button className="btn-ghost mb-8" onClick={onCancel}><ArrowLeft size={14} /> Cancel</button>

        <div className="label mb-3">Step one</div>
        <h1 className="display text-5xl font-light mb-3 leading-tight">Snap a recipe.</h1>
        <p className="mb-10" style={{ color: 'var(--ink-soft)' }}>
          Cookbook page, recipe card, handwritten note — anything legible. We'll read it and pull out the recipe.
        </p>

        {photo ? (
          <div className="mb-6">
            <div className="relative">
              <img src={photo} alt="" style={{ width: '100%', maxHeight: 480, objectFit: 'contain', background: 'var(--paper-deep)' }} />
              <button
                onClick={() => setPhoto(null)}
                className="absolute top-3 right-3 p-2"
                style={{ background: 'rgba(31, 24, 16, 0.85)', color: 'var(--paper)', borderRadius: 2, border: 'none', cursor: 'pointer' }}
                title="Replace photo"
              ><X size={14} /></button>
            </div>
          </div>
        ) : (
          <label className="block cursor-pointer mb-6" style={{ border: '1px dashed var(--line)', padding: '48px 32px', textAlign: 'center', transition: 'all 0.2s' }}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              disabled={photoProcessing}
              onChange={e => handlePhotoUpload(e.target.files?.[0])}
            />
            {photoProcessing ? (
              <span className="flex items-center justify-center gap-2" style={{ color: 'var(--ink-soft)' }}>
                <Loader2 size={16} className="spinning" /> Processing…
              </span>
            ) : (
              <>
                <Camera size={32} className="mx-auto mb-3" style={{ color: 'var(--ink-faint)' }} />
                <p style={{ color: 'var(--ink-soft)' }}>Tap to take a photo or pick from your library</p>
              </>
            )}
          </label>
        )}

        {error && (
          <div className="mb-6 p-4 flex items-start gap-3" style={{ background: 'rgba(179, 74, 44, 0.08)', border: '1px solid rgba(179, 74, 44, 0.3)' }}>
            <AlertCircle size={16} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p className="text-sm" style={{ color: 'var(--tomato-deep)' }}>{error}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>Try a clearer photo, or add by hand.</p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={handlePhotoExtract} disabled={!photo || scraping}>
            {scraping ? <><Loader2 size={14} className="spinning" /> Reading the page…</> : <><Sparkles size={14} /> Extract recipe</>}
          </button>
          <button className="btn-ghost" onClick={() => setMode('url')}>← Back</button>
        </div>

        <div className="mt-12 p-6" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
          <p className="label mb-2">Tips for best results</p>
          <ul className="text-sm space-y-1" style={{ color: 'var(--ink-soft)' }}>
            <li>· Good lighting, no glare on glossy pages.</li>
            <li>· One recipe per photo. Crop tightly if needed.</li>
            <li>· Handwriting works, but neat handwriting works better.</li>
          </ul>
        </div>
      </div>
    );
  }

  // URL mode (default)
  return (
    <div className="max-w-2xl mx-auto px-8 py-12 fadein">
      <button className="btn-ghost mb-8" onClick={onCancel}><ArrowLeft size={14} /> Cancel</button>

      <div className="label mb-3">Step one</div>
      <h1 className="display text-5xl font-light mb-3 leading-tight">Where's the recipe?</h1>
      <p className="mb-10" style={{ color: 'var(--ink-soft)' }}>
        Paste a link to a recipe page. We'll skip the life story and pull just the ingredients and steps.
      </p>

      {atRecipeCap && (
        <div className="mb-6 p-4 flex items-start gap-3" style={{ background: 'rgba(179, 74, 44, 0.08)', border: '1px solid rgba(179, 74, 44, 0.3)' }}>
          <AlertCircle size={16} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
          <div className="flex-1">
            <p className="text-sm" style={{ color: 'var(--tomato-deep)' }}>
              You've hit the {recipeCapCheck.limit}-recipe limit on Free.
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>
              Upgrade to Plus for unlimited recipes.
            </p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <label className="label block mb-3">Recipe URL</label>
        <input
          className="input"
          placeholder="https://example.com/best-chili-ever"
          value={url}
          onChange={e => setUrl(e.target.value)}
          disabled={scraping}
          onKeyDown={e => e.key === 'Enter' && handleScrape()}
        />
        {plan && plan.tier === 'free' && !urlCheck.unlimited && urlCheck.limit !== undefined && (
          <p className="text-xs mt-2" style={{ color: urlCheck.remaining === 0 ? 'var(--tomato)' : 'var(--ink-faint)' }}>
            {urlCheck.allowed
              ? `${urlCheck.used || 0} of ${urlCheck.limit} URL extractions used this month`
              : `Out of free URL extractions this month. Upgrade for unlimited.`}
          </p>
        )}
      </div>

      {urlDupe && (
        <div className="mb-6 p-4 fadein flex items-start gap-3" style={{ background: 'rgba(179, 74, 44, 0.08)', border: '1px solid var(--tomato)' }}>
          <AlertCircle size={16} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm mb-1" style={{ fontWeight: 500, color: 'var(--tomato-deep)' }}>
              You already have this recipe
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--ink-soft)' }}>
              Saved as "<em style={{ fontStyle: 'italic' }}>{urlDupe.recipe.title}</em>". Skip the AI call and open it directly?
            </p>
            <button className="btn-primary" onClick={() => onViewRecipe(urlDupe.recipe.id)} style={{ padding: '6px 12px', fontSize: 12 }}>
              <BookOpen size={12} /> View saved version
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 flex items-start gap-3" style={{ background: 'rgba(179, 74, 44, 0.08)', border: '1px solid rgba(179, 74, 44, 0.3)' }}>
          <AlertCircle size={16} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <p className="text-sm" style={{ color: 'var(--tomato-deep)' }}>{error}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--ink-soft)' }}>You can also try the photo or manual options.</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button className="btn-primary" onClick={handleScrape} disabled={!url.trim() || scraping || atRecipeCap}>
          {scraping ? <><Loader2 size={14} className="spinning" /> Reading the page…</> : <><LinkIcon size={14} /> Extract recipe</>}
        </button>
        <button className="btn-ghost" onClick={() => setMode('share_code')} disabled={atRecipeCap}><Send size={14} /> From a friend</button>
        <button className="btn-ghost" onClick={() => setMode('social')} disabled={atRecipeCap}><Sparkles size={14} /> From TikTok / Reels</button>
        <button className="btn-ghost" onClick={() => setMode('photo')} disabled={atRecipeCap}><Camera size={14} /> From a photo</button>
        <button className="btn-ghost" onClick={() => setMode('manual')} disabled={atRecipeCap}>By hand</button>
      </div>

      <div className="mt-16 p-6" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
        <p className="label mb-2">A note on Pinterest</p>
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          Pinterest pins link out to the original recipe site. Open the pin, follow the link to the actual recipe page, and paste that URL here. There's no clean way to bulk-import a Pinterest board, unfortunately.
        </p>
      </div>
    </div>
  );
}

// ---------- Edit View ----------
function EditView({ recipe, onCancel, onSaved, allRecipes, onViewRecipe }) {
  return <RecipeForm initial={recipe} onCancel={onCancel} onSaved={onSaved} title="Edit recipe" allRecipes={allRecipes} onViewRecipe={onViewRecipe} />;
}

// ---------- Recipe Form (used for add manual + edit + review extracted) ----------
function RecipeForm({ initial, onCancel, onSaved, title = 'New recipe', subtitle, allRecipes = [], onViewRecipe }) {
  const [data, setData] = useState({
    id: initial?.id || `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: initial?.title || '',
    source_url: initial?.source_url || '',
    hero_image: initial?.hero_image || initial?.image_url || null,
    ingredients: initial?.ingredients?.length ? initial.ingredients : [''],
    instructions: initial?.instructions?.length
      ? initial.instructions.map(s => ({
          text: getStepText(s),
          duration_min: getStepDuration(s) || ''
        }))
      : [{ text: '', duration_min: '' }],
    prep_time: initial?.prep_time || '',
    cook_time: initial?.cook_time || '',
    servings: initial?.servings || '',
    diet_tags: initial?.diet_tags || [],
    collections: initial?.collections || [],
    notes: initial?.notes || '',
    cook_log: initial?.cook_log || [],
    favorite: initial?.favorite || false,
    created_at: initial?.created_at || Date.now(),
    updated_at: Date.now()
  });
  const [saving, setSaving] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [collectionInput, setCollectionInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [dupeDismissed, setDupeDismissed] = useState(false);

  // Detect duplicates / similar recipes only when this is a NEW recipe (no initial.id matching one in the cookbook)
  const dupeCheck = useMemo(() => {
    const isExisting = initial?.id && allRecipes.some(r => r.id === initial.id);
    if (isExisting) return { exact: null, similar: [] };
    const candidate = { ...data, id: data.id }; // include current draft id so it's filtered out
    return {
      exact: findExactDuplicate(allRecipes, candidate),
      similar: findSimilarRecipes(allRecipes, candidate)
    };
  }, [data.title, data.source_url, allRecipes, initial?.id]);

  const update = (k, v) => setData(d => ({ ...d, [k]: v }));  const updateList = (k, i, v) => setData(d => {
    const next = [...d[k]];
    next[i] = v;
    return { ...d, [k]: next };
  });
  const updateStep = (i, field, value) => setData(d => {
    const next = [...d.instructions];
    next[i] = { ...next[i], [field]: value };
    return { ...d, instructions: next };
  });
  const addLine = (k) => setData(d => ({
    ...d,
    [k]: [...d[k], k === 'instructions' ? { text: '', duration_min: '' } : '']
  }));
  const removeLine = (k, i) => setData(d => ({ ...d, [k]: d[k].filter((_, idx) => idx !== i) }));
  const toggleTag = (t) => setData(d => ({
    ...d,
    diet_tags: d.diet_tags.includes(t) ? d.diet_tags.filter(x => x !== t) : [...d.diet_tags, t]
  }));

  const handleSave = async () => {
    if (!data.title.trim()) return;
    setSaving(true);
    const cleaned = {
      ...data,
      title: data.title.trim(),
      ingredients: data.ingredients.map(s => s.trim()).filter(Boolean),
      instructions: data.instructions
        .filter(s => (s.text || '').trim())
        .map(s => makeStep(s.text.trim(), parseInt(s.duration_min, 10) || null)),
      updated_at: Date.now()
    };
    try {
      await storage.save(cleaned);
      onSaved(cleaned);
    } catch (e) {
      alert('Save failed: ' + e.message);
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-8 py-12 fadein">
      <button className="btn-ghost mb-8" onClick={onCancel}><ArrowLeft size={14} /> Back</button>

      <div className="label mb-3">{title}</div>
      {subtitle && <p className="mb-8" style={{ color: 'var(--ink-soft)' }}>{subtitle}</p>}

      {!dupeDismissed && (dupeCheck.exact || dupeCheck.similar.length > 0) && (
        <DuplicateWarning
          exact={dupeCheck.exact}
          similar={dupeCheck.similar}
          onViewRecipe={onViewRecipe || (() => {})}
          onDismiss={() => setDupeDismissed(true)}
        />
      )}

      <input
        className="input display text-4xl mb-10"
        style={{ fontWeight: 300, padding: '12px 0', borderBottomWidth: 2 }}
        placeholder="Recipe title"
        value={data.title}
        onChange={e => update('title', e.target.value)}
      />

      {/* Hero image */}
      <section className="mb-10">
        <label className="label block mb-3">Hero photo</label>
        {data.hero_image ? (
          <div className="relative group">
            <img
              src={data.hero_image}
              alt="Recipe hero"
              style={{ width: '100%', maxHeight: 360, objectFit: 'cover', borderRadius: 2 }}
            />
            <button
              onClick={() => update('hero_image', null)}
              className="absolute top-3 right-3 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'rgba(31, 24, 16, 0.85)', color: 'var(--paper)', borderRadius: 2 }}
              title="Remove photo"
            ><X size={14} /></button>
          </div>
        ) : (
          <label className="block cursor-pointer" style={{ border: '1px dashed var(--line)', padding: '32px', textAlign: 'center', transition: 'all 0.2s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ink-soft)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
          >
            <input
              type="file"
              accept="image/*"
              className="hidden"
              style={{ display: 'none' }}
              disabled={uploadingHero}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploadingHero(true);
                try {
                  const dataUrl = await compressImage(file, { maxWidth: 1600, quality: 0.82 });
                  update('hero_image', dataUrl);
                } catch (err) {
                  alert('Could not load image: ' + err.message);
                } finally {
                  setUploadingHero(false);
                }
              }}
            />
            {uploadingHero ? (
              <span className="flex items-center justify-center gap-2" style={{ color: 'var(--ink-soft)' }}>
                <Loader2 size={14} className="spinning" /> Processing…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2" style={{ color: 'var(--ink-soft)' }}>
                <Camera size={14} /> Add a photo
              </span>
            )}
          </label>
        )}
      </section>

      <div className="grid grid-cols-3 gap-6 mb-10">
        <div>
          <label className="label block mb-2">Prep</label>
          <input className="input" placeholder="e.g. 15 min" value={data.prep_time} onChange={e => update('prep_time', e.target.value)} />
        </div>
        <div>
          <label className="label block mb-2">Cook</label>
          <input className="input" placeholder="e.g. 30 min" value={data.cook_time} onChange={e => update('cook_time', e.target.value)} />
        </div>
        <div>
          <label className="label block mb-2">Serves</label>
          <input className="input" placeholder="e.g. 4" value={data.servings} onChange={e => update('servings', e.target.value)} />
        </div>
      </div>

      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="display text-2xl">Ingredients</h2>
          <button className="btn-ghost" onClick={() => addLine('ingredients')}><Plus size={12} /> Add</button>
        </div>
        <div className="space-y-2">
          {data.ingredients.map((ing, i) => (
            <div key={i} className="flex items-center gap-2 group">
              <span className="mono text-xs w-6" style={{ color: 'var(--ink-faint)' }}>{String(i + 1).padStart(2, '0')}</span>
              <input
                className="input"
                placeholder="Add an ingredient…"
                value={ing}
                onChange={e => updateList('ingredients', i, e.target.value)}
              />
              {data.ingredients.length > 1 && (
                <button onClick={() => removeLine('ingredients', i)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1" style={{ color: 'var(--ink-faint)' }}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="display text-2xl">Method</h2>
          <button className="btn-ghost" onClick={() => addLine('instructions')}><Plus size={12} /> Add step</button>
        </div>
        {(() => {
          const total = data.instructions.reduce((sum, s) => sum + (parseInt(s.duration_min, 10) || 0), 0);
          return total > 0 ? (
            <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>
              Total active: ~{formatStepDuration(total)}
            </p>
          ) : (
            <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>
              Optionally add a minute estimate for each step (faded number on the right).
            </p>
          );
        })()}
        <div className="space-y-3">
          {data.instructions.map((step, i) => (
            <div key={i} className="flex items-start gap-3 group">
              <span className="display text-2xl mt-1" style={{ color: 'var(--tomato)', minWidth: 32 }}>{i + 1}</span>
              <div className="flex-1 flex items-start gap-2">
                <AutoGrowTextarea
                  className="input"
                  style={{ padding: '8px 0', lineHeight: 1.6, flex: 1 }}
                  placeholder="Describe this step…"
                  minRows={2}
                  value={step.text}
                  onChange={e => updateStep(i, 'text', e.target.value)}
                />
                <input
                  type="number"
                  min="1"
                  className="input"
                  style={{
                    width: 64,
                    padding: '8px 0 8px 8px',
                    fontSize: 13,
                    color: step.duration_min ? 'var(--ink-soft)' : 'var(--ink-faint)',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                  placeholder="min"
                  title="Estimated minutes for this step (optional)"
                  value={step.duration_min}
                  onChange={e => updateStep(i, 'duration_min', e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
              {data.instructions.length > 1 && (
                <button onClick={() => removeLine('instructions', i)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 mt-2" style={{ color: 'var(--ink-faint)' }}>
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="label mb-2">Diet tags</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>
          Tap a common one to toggle, or type your own (AIP, FODMAP, halal, kid-friendly, anything).
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Predefined — toggle on/off */}
          {DIET_TAGS.map(t => (
            <button
              key={t}
              className={`tag-chip ${data.diet_tags.includes(t) ? 'active' : ''}`}
              onClick={() => toggleTag(t)}
            >{t}</button>
          ))}
          {/* Custom — removable chips */}
          {data.diet_tags.filter(t => !DIET_TAGS.includes(t)).map((t, i) => (
            <span key={`custom-${t}`} className="pantry-chip">
              {t}
              <button
                onClick={() => setData(d => ({ ...d, diet_tags: d.diet_tags.filter(x => x !== t) }))}
              ><X size={11} /></button>
            </span>
          ))}
          {/* Add custom input */}
          <input
            className="input"
            style={{ width: 'auto', minWidth: 140, flex: '0 1 auto', fontSize: 13 }}
            placeholder="+ add custom"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const v = tagInput.trim().toLowerCase();
                if (v && !data.diet_tags.some(x => x.toLowerCase() === v)) {
                  setData(d => ({ ...d, diet_tags: [...d.diet_tags, v] }));
                }
                setTagInput('');
              } else if (e.key === 'Backspace' && !tagInput) {
                // Remove last custom tag (don't touch predefined toggles via backspace)
                const customs = data.diet_tags.filter(t => !DIET_TAGS.includes(t));
                if (customs.length > 0) {
                  const last = customs[customs.length - 1];
                  setData(d => ({ ...d, diet_tags: d.diet_tags.filter(x => x !== last) }));
                }
              }
            }}
          />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="label mb-2">Collections</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>
          Group recipes your way: "Mom's", "Holiday menu", "Weeknight quick wins". Press Enter to add.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {data.collections.map((c, i) => (
            <span key={i} className="pantry-chip">
              {c}
              <button
                onClick={() => setData(d => ({ ...d, collections: d.collections.filter((_, idx) => idx !== i) }))}
              ><X size={11} /></button>
            </span>
          ))}
          <input
            className="input"
            style={{ width: 'auto', minWidth: 180, flex: 1 }}
            placeholder="add a collection…"
            value={collectionInput}
            onChange={e => setCollectionInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const v = collectionInput.trim();
                if (v && !data.collections.some(c => c.toLowerCase() === v.toLowerCase())) {
                  setData(d => ({ ...d, collections: [...d.collections, v] }));
                }
                setCollectionInput('');
              } else if (e.key === 'Backspace' && !collectionInput && data.collections.length > 0) {
                setData(d => ({ ...d, collections: d.collections.slice(0, -1) }));
              }
            }}
          />
        </div>
      </section>

      <section className="mb-10">
        <label className="label block mb-3">Notes</label>
        <AutoGrowTextarea
          className="input"
          style={{ padding: '8px 0', lineHeight: 1.6 }}
          placeholder="Any tips, swaps, or family-secret modifications…"
          minRows={3}
          value={data.notes}
          onChange={e => update('notes', e.target.value)}
        />
      </section>

      {data.source_url && (
        <section className="mb-10">
          <label className="label block mb-2">Source</label>
          <p className="text-sm flex items-center gap-2" style={{ color: 'var(--ink-soft)' }}>
            <LinkIcon size={12} />
            <span className="truncate">{cleanUrl(data.source_url)}</span>
          </p>
        </section>
      )}

      <div className="flex items-center gap-3 pt-6" style={{ borderTop: '1px solid var(--line)' }}>
        <button className="btn-primary" onClick={handleSave} disabled={!data.title.trim() || saving}>
          {saving ? <><Loader2 size={14} className="spinning" /> Saving…</> : <><Check size={14} /> Save recipe</>}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- Detail View ----------
function DetailView({ recipe, onBack, onEdit, onDelete, onCookMode, onAddToShopping, shoppingList, onRecipeUpdate, plan, requireFeature, bumpUsage, userSubs, onAddUserSub, onRemoveUserSub, prefs }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(null);
  const [scale, setScale] = useState(1);
  const [customMode, setCustomMode] = useState(false);
  const [targetServings, setTargetServings] = useState('');
  const [logFormOpen, setLogFormOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [cookLog, setCookLog] = useState(recipe.cook_log || []);
  const [adaptedMethod, setAdaptedMethod] = useState(null);
  const [adaptingMethod, setAdaptingMethod] = useState(false);
  const [adaptError, setAdaptError] = useState(null);
  const [subsState, setSubsState] = useState({}); // ingredient -> { loading, results, error, expanded }
  // Estimate step times state
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState(null);
  const [estimateReview, setEstimateReview] = useState(null);
  const [sendToFriendOpen, setSendToFriendOpen] = useState(false);

  useEffect(() => { setCookLog(recipe.cook_log || []); }, [recipe.id]);
  // Reset the adapted method whenever the scale changes
  useEffect(() => { setAdaptedMethod(null); setAdaptError(null); }, [scale]);

  const handleEstimateTimes = async () => {
    if (requireFeature && !requireFeature('method_adapt')) return;
    setEstimating(true);
    setEstimateError(null);
    try {
      const proposed = await estimateStepTimes(recipe.instructions || []);
      if (bumpUsage) await bumpUsage('method_adapt');
      // Build review state — only include steps without an existing duration
      const reviewItems = (recipe.instructions || []).map((step, i) => ({
        stepIdx: i,
        text: getStepText(step),
        existing: getStepDuration(step),
        proposed: proposed[i] || null,
        accepted: proposed[i] || null
      }));
      setEstimateReview({ items: reviewItems });
    } catch (e) {
      setEstimateError(e.message || 'Could not estimate times');
    } finally {
      setEstimating(false);
    }
  };

  const applyEstimates = async () => {
    if (!estimateReview) return;
    const newSteps = (recipe.instructions || []).map((step, i) => {
      const review = estimateReview.items[i];
      if (!review) return step;
      // Use accepted value if present, otherwise keep existing duration, otherwise plain text
      const finalDuration = review.accepted || review.existing || null;
      const text = getStepText(step);
      return finalDuration ? { text, duration_min: finalDuration } : text;
    });
    const updated = { ...recipe, instructions: newSteps, updated_at: Date.now() };
    await storage.save(updated);
    onRecipeUpdate(updated);
    setEstimateReview(null);
  };

  const handleAdaptMethod = async () => {
    if (requireFeature && !requireFeature('method_adapt')) return;
    setAdaptingMethod(true);
    setAdaptError(null);
    try {
      const rewritten = await rewriteMethodForScale(recipe.instructions || [], scale);
      if (bumpUsage) await bumpUsage('method_adapt');
      setAdaptedMethod(rewritten);
    } catch (e) {
      setAdaptError(e.message || 'Could not adapt method');
    } finally {
      setAdaptingMethod(false);
    }
  };

  const handleGetSubs = async (ingredient) => {
    const existing = subsState[ingredient];
    if (existing?.results) {
      setSubsState(s => ({ ...s, [ingredient]: { ...existing, expanded: !existing.expanded } }));
      return;
    }
    // 1. User-saved subs always win — they're the user's own preferences
    const userMatches = findUserSubs(userSubs?.items || [], ingredient);
    if (userMatches.length > 0) {
      setSubsState(s => ({
        ...s,
        [ingredient]: {
          loading: false,
          results: userMatches.map(m => ({ swap: m.swap, ratio: m.ratio, notes: m.notes, _userId: m.id })),
          error: null,
          expanded: true,
          source: 'user'
        }
      }));
      return;
    }
    // 2. Curated kitchen library — instant, no API
    const fromLib = findSubsInLibrary(ingredient);
    if (fromLib) {
      setSubsState(s => ({
        ...s,
        [ingredient]: { loading: false, results: fromLib.subs, error: null, expanded: true, source: 'library', libraryKey: fromLib.key }
      }));
      return;
    }
    // 3. AI fallback for everything else
    if (requireFeature && !requireFeature('substitutions')) return;
    setSubsState(s => ({ ...s, [ingredient]: { loading: true, results: null, error: null, expanded: true } }));
    try {
      const results = await getSubstitutions(ingredient, recipe);
      if (bumpUsage) await bumpUsage('substitutions');
      setSubsState(s => ({ ...s, [ingredient]: { loading: false, results, error: null, expanded: true, source: 'ai' } }));
    } catch (e) {
      setSubsState(s => ({ ...s, [ingredient]: { loading: false, results: null, error: e.message || 'Could not fetch substitutions', expanded: true } }));
    }
  };

  // Track which ingredient currently has the "add your own swap" form open
  const [addSubFor, setAddSubFor] = useState(null);
  const [newSubData, setNewSubData] = useState({ swap: '', ratio: '', notes: '' });
  const handleSaveUserSub = async () => {
    if (!addSubFor || !newSubData.swap.trim()) return;
    await onAddUserSub({
      ingredient: addSubFor,
      swap: newSubData.swap,
      ratio: newSubData.ratio,
      notes: newSubData.notes
    });
    // Refresh the subs panel to show the new user sub
    setSubsState(s => ({ ...s, [addSubFor]: undefined }));
    setAddSubFor(null);
    setNewSubData({ swap: '', ratio: '', notes: '' });
    // Re-fetch to show the just-added user sub in the panel
    setTimeout(() => handleGetSubs(addSubFor), 50);
  };

  // ---- Ingredient info modal ----
  // infoModal holds { ingredient } when open. infoState caches results per
  // ingredient so reopening doesn't re-fetch (and library hits stay instant).
  const [infoModal, setInfoModal] = useState(null);
  const [infoState, setInfoState] = useState({});
  const handleShowInfo = async (ingredient) => {
    setInfoModal({ ingredient });
    const existing = infoState[ingredient];
    if (existing?.results || existing?.loading) return;
    // Try curated library first
    const fromLib = findIngredientInfo(ingredient);
    if (fromLib) {
      setInfoState(s => ({ ...s, [ingredient]: { loading: false, results: fromLib.info, error: null, source: 'library', libraryKey: fromLib.key } }));
      return;
    }
    // AI fallback
    setInfoState(s => ({ ...s, [ingredient]: { loading: true, results: null, error: null } }));
    try {
      const results = await getIngredientInfo(ingredient);
      setInfoState(s => ({ ...s, [ingredient]: { loading: false, results, error: null, source: 'ai' } }));
    } catch (e) {
      setInfoState(s => ({ ...s, [ingredient]: { loading: false, results: null, error: e.message || 'Could not fetch info' } }));
    }
  };
  const closeInfo = () => setInfoModal(null);

  const handlePrint = () => {
    document.body.classList.add('printing');
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove('printing'), 200);
    }, 60);
  };

  // Which set of instructions to display
  const displayedInstructions = adaptedMethod || recipe.instructions || [];

  // Try to extract a base servings number for the "scale to N" feature
  const baseServings = useMemo(() => {
    if (!recipe.servings) return null;
    const m = String(recipe.servings).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }, [recipe.servings]);

  const scaledIngredients = useMemo(
    () => (recipe.ingredients || []).map(i => scale === 1 ? i : scaleIngredient(i, scale)),
    [recipe.ingredients, scale]
  );
  const scaledServings = useMemo(
    () => scale === 1 ? recipe.servings : scaleServings(recipe.servings, scale),
    [recipe.servings, scale]
  );

  const isScaled = scale !== 1;

  const handleCustomScale = () => {
    const target = parseFloat(targetServings);
    if (!target || !baseServings || target <= 0) return;
    setScale(target / baseServings);
    setCustomMode(false);
  };

  const handleAddLogEntry = async (entry) => {
    const newLog = [entry, ...cookLog];
    const updated = { ...recipe, cook_log: newLog, updated_at: Date.now() };
    setCookLog(newLog);
    setLogFormOpen(false);
    try {
      await storage.save(updated);
    } catch (e) {
      alert('Could not save log entry: ' + e.message);
    }
  };

  const handleDeleteLogEntry = async (entryId) => {
    // Direct delete; window.confirm is unreliable in iframes. Log entries
    // are easy to re-add if needed.
    const newLog = cookLog.filter(l => l.id !== entryId);
    const updated = { ...recipe, cook_log: newLog, updated_at: Date.now() };
    setCookLog(newLog);
    try {
      await storage.save(updated);
    } catch (e) {
      alert('Could not delete: ' + e.message);
    }
  };

  const handleRateLogEntry = async (entryId, rating) => {
    const newLog = cookLog.map(l => l.id === entryId ? { ...l, rating } : l);
    const updated = { ...recipe, cook_log: newLog, updated_at: Date.now() };
    setCookLog(newLog);
    try {
      await storage.save(updated);
    } catch (e) {
      console.error('Could not save rating', e);
    }
  };

  const formatAsText = () => {
    const ings = scale === 1 ? recipe.ingredients : scaledIngredients;
    const servs = scale === 1 ? recipe.servings : scaledServings;
    const steps = adaptedMethod || recipe.instructions || [];
    let out = `${recipe.title.toUpperCase()}\n${'='.repeat(recipe.title.length)}\n\n`;
    if (isScaled) out += `[Scaled to ${formatQuantity(scale)}× original${adaptedMethod ? ' — method adapted' : ''}]\n`;
    if (servs) out += `Serves: ${servs}\n`;
    if (recipe.prep_time) out += `Prep: ${recipe.prep_time}${isScaled ? ' (unscaled)' : ''}\n`;
    if (recipe.cook_time) out += `Cook: ${recipe.cook_time}${isScaled ? ' (unscaled — check early)' : ''}\n`;
    const totalActive = totalStepDuration(steps);
    if (totalActive) out += `Total active: ~${formatStepDuration(totalActive)}\n`;
    out += '\nINGREDIENTS\n-----------\n';
    (ings || []).forEach(i => out += `• ${i}\n`);
    out += '\nMETHOD\n------\n';
    steps.forEach((s, i) => {
      const dur = getStepDuration(s);
      const durLabel = dur ? ` [~${formatStepDuration(dur)}]` : '';
      out += `${i + 1}.${durLabel} ${getStepText(s)}\n\n`;
    });
    if (recipe.notes) out += `\nNOTES\n-----\n${recipe.notes}\n`;
    if (recipe.source_url) out += `\nSource: ${cleanUrl(recipe.source_url)}`;
    return out;
  };

  const handleCopy = async (kind) => {
    const text = kind === 'json' ? JSON.stringify(recipe, null, 2) : formatAsText();
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1800);
  };

  const [renderingImage, setRenderingImage] = useState(false);
  const [imageError, setImageError] = useState(null);
  const handleSaveImage = async () => {
    setRenderingImage(true);
    setImageError(null);
    try {
      const dataUrl = await renderRecipeAsImage(recipe);
      const link = document.createElement('a');
      link.download = `${(recipe.title || 'recipe').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      setImageError(e.message || 'Could not render image');
    } finally {
      setRenderingImage(false);
    }
  };

  const inShoppingList = shoppingList?.recipes?.some(r => r.id === recipe.id);
  const handleAddToShopping = () => {
    if (!onAddToShopping) return;
    onAddToShopping({
      id: recipe.id,
      title: recipe.title,
      scale,
      ingredients: scaledIngredients,
      hero_image: recipe.hero_image
    });
  };

  return (
    <div className="max-w-3xl mx-auto fadein">
      {/* Hero image — full-width at top, anchors the page identity */}
      {recipe.hero_image && (
        <div style={{ position: 'relative' }}>
          <img
            src={recipe.hero_image}
            alt={recipe.title}
            style={{ width: '100%', maxHeight: 'min(60vh, 540px)', objectFit: 'cover', display: 'block' }}
            onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
          />
          <button
            onClick={onBack}
            className="no-print"
            style={{
              position: 'absolute', top: 16, left: 16,
              background: 'rgba(244,237,224,0.92)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: 'none', color: 'var(--ink)', cursor: 'pointer',
              width: 40, height: 40, borderRadius: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
              WebkitTapHighlightColor: 'rgba(0,0,0,0.1)',
              touchAction: 'manipulation'
            }}
            aria-label="Back to cookbook"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
        </div>
      )}

      <div className="px-8 py-10">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-2 no-print">
          {!recipe.hero_image ? (
            <button className="btn-ghost" onClick={onBack}><ArrowLeft size={14} /> Cookbook</button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <button className="btn-primary" onClick={onCookMode} style={{ marginRight: 8 }}>
              <Flame size={14} /> Cook mode
            </button>
            <button className="btn-ghost" onClick={handleAddToShopping}>
              {inShoppingList ? <><Check size={14} /> In list</> : <><ShoppingBasket size={14} /> Add to list</>}
            </button>
            <button className="btn-ghost" onClick={handlePrint}>
              <Printer size={14} /> Print
            </button>
            <button className="btn-ghost" onClick={() => setShareOpen(!shareOpen)}><Share2 size={14} /> Share</button>
            <button className="btn-ghost" onClick={onEdit}><Edit3 size={14} /> Edit</button>
            <button className="btn-ghost" onClick={onDelete} style={{ color: 'var(--tomato)' }}><Trash2 size={14} /></button>
          </div>
        </div>

        {shareOpen && (
          <div className="mb-10 p-6 fadein no-print" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
            <p className="label mb-4">Share this recipe{isScaled && ` (scaled ${formatQuantity(scale)}×)`}</p>
            <div className="flex flex-wrap gap-3">
              <button className="btn-primary" onClick={() => setSendToFriendOpen(true)}>
                <Send size={14} /> Send to a friend
              </button>
              <button className="btn-ghost" onClick={handleSaveImage} disabled={renderingImage}>
                {renderingImage ? <><Loader2 size={14} className="spinning" /> Rendering…</> : <><ImageIcon size={14} /> Save as image</>}
              </button>
              <button className="btn-ghost" onClick={() => handleCopy('text')}>
                {copied === 'text' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy as text</>}
              </button>
              <button className="btn-ghost" onClick={() => handleCopy('json')}>
                {copied === 'json' ? <><Check size={14} /> Copied</> : <><Download size={14} /> Copy as JSON</>}
              </button>
            </div>
            {imageError && (
              <p className="text-xs mt-3" style={{ color: 'var(--tomato)' }}>{imageError}</p>
            )}
            <p className="text-xs mt-4" style={{ color: 'var(--ink-faint)' }}>
              <strong>Send to a friend:</strong> generates a code your friend can paste into their cookbook to add this recipe instantly. <strong>Image:</strong> beautifully laid-out PNG. <strong>Text/JSON:</strong> copies anywhere. If the hero image is from an external site, it may not embed in the PNG — upload your own copy via the edit form for guaranteed inclusion.
            </p>
          </div>
        )}

        <div className="label mb-4">Recipe</div>
      <div className="flex items-start gap-4 mb-6">
        <h1 className="display text-5xl md:text-6xl font-light leading-tight" style={{ letterSpacing: '-0.03em', flex: 1 }}>
          {recipe.title}
        </h1>
        <button
          onClick={async () => {
            const updated = { ...recipe, favorite: !recipe.favorite, updated_at: Date.now() };
            await storage.save(updated);
            onRecipeUpdate?.(updated);
          }}
          className="no-print"
          style={{
            background: 'transparent',
            color: recipe.favorite ? 'var(--tomato)' : 'var(--ink-faint)',
            border: 'none',
            cursor: 'pointer',
            padding: 8,
            marginTop: 12,
            transition: 'all 0.2s'
          }}
          title={recipe.favorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={28} fill={recipe.favorite ? 'currentColor' : 'none'} strokeWidth={1.5} />
        </button>
      </div>

      {(recipe.diet_tags || []).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-8">
          {recipe.diet_tags.map(t => <span key={t} className="tag-chip" style={{ pointerEvents: 'none' }}>{t}</span>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mb-8 pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        {recipe.prep_time && <Stat icon={<Clock size={14} />} label="Prep" value={recipe.prep_time} />}
        {recipe.cook_time && <Stat icon={<ChefHat size={14} />} label="Cook" value={recipe.cook_time} />}
        {scaledServings && <Stat icon={<Users size={14} />} label="Serves" value={scaledServings} />}
        {cookLog.length > 0 && <Stat icon={<BookOpen size={14} />} label="Cooked" value={`${cookLog.length}×`} />}
      </div>

      {/* Scale controls */}
      <div className="mb-12 no-print">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="label flex items-center gap-2"><Scale size={12} /> Scale</span>
          <div className="flex flex-wrap gap-1.5">
            {SCALE_PRESETS.map(p => (
              <button
                key={p.value}
                className={`tag-chip ${Math.abs(scale - p.value) < 0.001 ? 'active' : ''}`}
                onClick={() => { setScale(p.value); setCustomMode(false); }}
              >{p.label}</button>
            ))}
            {baseServings && (
              <button
                className={`tag-chip ${customMode || (scale !== 1 && !SCALE_PRESETS.some(p => Math.abs(scale - p.value) < 0.001)) ? 'active' : ''}`}
                onClick={() => setCustomMode(!customMode)}
              >Serve…</button>
            )}
            {isScaled && (
              <button
                className="tag-chip flex items-center gap-1.5"
                onClick={() => { setScale(1); setCustomMode(false); }}
                style={{ color: 'var(--tomato)' }}
              ><RotateCcw size={10} /> reset</button>
            )}
          </div>
        </div>

        {customMode && baseServings && (
          <div className="flex items-center gap-3 mt-3 fadein">
            <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>Make for</span>
            <input
              className="input"
              style={{ width: 80 }}
              type="number"
              placeholder={String(baseServings)}
              value={targetServings}
              onChange={e => setTargetServings(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCustomScale()}
              autoFocus
            />
            <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              {parseFloat(targetServings) === 1 ? 'person' : 'people'}
            </span>
            <button className="btn-ghost" onClick={handleCustomScale} disabled={!targetServings}>Apply</button>
          </div>
        )}

        {isScaled && (
          <div className="mt-4 p-4 fadein" style={{ background: 'rgba(179, 74, 44, 0.06)', border: '1px solid rgba(179, 74, 44, 0.2)' }}>
            <div className="flex items-start gap-2 mb-3">
              <AlertCircle size={12} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 4 }} />
              <p className="text-xs" style={{ color: 'var(--ink-soft)', lineHeight: 1.5 }}>
                Ingredients scaled to <strong>{formatQuantity(scale)}×</strong>. Cook and prep times don't scale linearly — start checking for doneness {scale < 1 ? 'earlier' : 'around the original time'}, especially for roasted, baked, or simmered dishes.
                {!adaptedMethod && ' The written method below still has original quantities.'}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-wrap" style={{ paddingLeft: 18 }}>
              {!adaptedMethod ? (
                <button
                  className="btn-ghost text-xs"
                  onClick={handleAdaptMethod}
                  disabled={adaptingMethod}
                  style={{ padding: '4px 10px', border: '1px solid var(--line)' }}
                >
                  {adaptingMethod ? <><Loader2 size={11} className="spinning" /> Rewriting steps…</> : <>✨ Adapt method to scale</>}
                </button>
              ) : (
                <>
                  <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--tomato-deep)' }}>
                    <Check size={11} /> Method adapted to {formatQuantity(scale)}×
                  </span>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setAdaptedMethod(null)}
                    style={{ padding: '4px 10px' }}
                  >Show original</button>
                </>
              )}
              {adaptError && (
                <span className="text-xs" style={{ color: 'var(--tomato)' }}>{adaptError}</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
        <aside className="md:col-span-1">
          <h2 className="display text-2xl mb-5">Ingredients</h2>
          <ul className="space-y-2.5">
            {scaledIngredients.map((ing, i) => {
              if (isIngredientSection(ing)) {
                return (
                  <li key={i} className="pt-3 first:pt-0">
                    <h3 className="label" style={{ color: 'var(--tomato)', letterSpacing: '0.18em' }}>
                      {cleanSectionLabel(ing)}
                    </h3>
                  </li>
                );
              }
              // Sub state is keyed against the ORIGINAL (pre-scale) ingredient text
              // so scaling doesn't lose the cached substitutions.
              const original = (recipe.ingredients || [])[i] || ing;
              const state = subsState[original];
              const expanded = state?.expanded;
              const display = splitIngredientForDisplay(ing);
              return (
                <li key={i}>
                  <div className="ing-row group" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, lineHeight: 1.6, fontSize: 14 }}>
                    <span style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 4 }}>·</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--ink)' }}>{display.name}</span>
                        {display.amount && (
                          <span
                            className="mono"
                            style={{
                              marginLeft: 'auto',
                              fontSize: 12,
                              color: 'var(--ink-faint)',
                              flexShrink: 0,
                              whiteSpace: 'nowrap',
                              fontVariantNumeric: 'tabular-nums'
                            }}
                          >
                            {display.amount}
                          </span>
                        )}
                        <div
                          className="ing-actions no-print opacity-40 md:opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ display: 'flex', gap: 2, flexShrink: 0, alignItems: 'center' }}
                        >
                          {prefs?.showIngredientInfo && (
                            <button
                              onClick={() => handleShowInfo(original)}
                              title="Learn about this ingredient"
                              aria-label="Learn about this ingredient"
                              style={{
                                background: 'transparent',
                                border: 'none',
                                padding: 4,
                                cursor: 'pointer',
                                color: 'var(--ink-faint)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                minWidth: 28,
                                minHeight: 28,
                                borderRadius: 4,
                                transition: 'color 0.15s',
                                WebkitTapHighlightColor: 'rgba(179,74,44,0.15)',
                                touchAction: 'manipulation'
                              }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--ink)'; }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--ink-faint)'; }}
                            >
                              <Info size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => handleGetSubs(original)}
                            disabled={state?.loading}
                            title={
                              state?.loading ? 'Finding substitutes…' :
                              state?.results ? (expanded ? 'Hide substitutes' : 'Show substitutes') :
                              'Find a substitute'
                            }
                            aria-label="Substitutions"
                            style={{
                              background: state?.results ? 'rgba(179,74,44,0.12)' : 'transparent',
                              border: 'none',
                              padding: 4,
                              cursor: state?.loading ? 'wait' : 'pointer',
                              color: state?.results ? 'var(--tomato)' : 'var(--ink-faint)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              minWidth: 28,
                              minHeight: 28,
                              borderRadius: 4,
                              transition: 'color 0.15s, background 0.15s',
                              WebkitTapHighlightColor: 'rgba(179,74,44,0.15)',
                              touchAction: 'manipulation'
                            }}
                            onMouseEnter={e => { if (!state?.results) e.currentTarget.style.color = 'var(--ink)'; }}
                            onMouseLeave={e => { if (!state?.results) e.currentTarget.style.color = 'var(--ink-faint)'; }}
                          >
                            {state?.loading ? <Loader2 size={13} className="spinning" /> : <Replace size={13} />}
                          </button>
                        </div>
                      </div>
                      {display.note && (
                        <p style={{
                          fontSize: 12,
                          color: 'var(--ink-faint)',
                          fontStyle: 'italic',
                          marginTop: 2,
                          lineHeight: 1.4
                        }}>
                          {display.note}
                        </p>
                      )}
                    </div>
                  </div>
                  {expanded && state?.results && (
                    <div className="ml-5 mt-2 mb-3 pl-4 fadein no-print" style={{ borderLeft: '2px solid var(--tomato)' }}>
                      <p className="label mb-2" style={{ color: state.source === 'user' ? 'var(--tomato)' : 'var(--ink-faint)', fontSize: 9, letterSpacing: '0.15em' }}>
                        {state.source === 'user' ? 'Your swaps' :
                         state.source === 'library' ? 'Common kitchen swaps' :
                         'Suggested for this recipe'}
                      </p>
                      {state.results.map((sub, si) => (
                        <div key={si} className="mb-2 text-sm group/sub" style={{ position: 'relative' }}>
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <strong style={{ fontWeight: 600 }}>{sub.swap}</strong>
                            {sub.ratio && <span className="mono text-xs" style={{ color: 'var(--ink-faint)' }}>{sub.ratio}</span>}
                            {sub._userId && onRemoveUserSub && (
                              <button
                                onClick={async () => {
                                  await onRemoveUserSub(sub._userId);
                                  // Re-trigger the lookup to update the panel
                                  setSubsState(s => ({ ...s, [original]: undefined }));
                                  setTimeout(() => handleGetSubs(original), 50);
                                }}
                                className="opacity-0 group-hover/sub:opacity-100 transition-opacity"
                                style={{ background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', padding: 2, marginLeft: 'auto' }}
                                title="Remove this saved swap"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                          {sub.notes && <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>{sub.notes}</p>}
                        </div>
                      ))}
                      {/* Add my own swap affordance */}
                      {addSubFor !== original ? (
                        <button
                          onClick={() => { setAddSubFor(original); setNewSubData({ swap: '', ratio: '', notes: '' }); }}
                          className="text-xs mt-2"
                          style={{ background: 'none', border: 'none', color: 'var(--tomato)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <Plus size={11} /> Save your own swap for this
                        </button>
                      ) : (
                        <div className="mt-3 p-3 fadein" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
                          <p className="label mb-2" style={{ color: 'var(--tomato)' }}>Save your own swap</p>
                          <input
                            className="input mb-2"
                            style={{ fontSize: 13, padding: '6px 0' }}
                            placeholder="What you swap with (e.g., 'homemade kefir')"
                            value={newSubData.swap}
                            onChange={e => setNewSubData(d => ({ ...d, swap: e.target.value }))}
                            autoFocus
                          />
                          <input
                            className="input mb-2"
                            style={{ fontSize: 13, padding: '6px 0' }}
                            placeholder="Ratio (optional, e.g. '1:1')"
                            value={newSubData.ratio}
                            onChange={e => setNewSubData(d => ({ ...d, ratio: e.target.value }))}
                          />
                          <input
                            className="input mb-3"
                            style={{ fontSize: 13, padding: '6px 0' }}
                            placeholder="Notes (optional)"
                            value={newSubData.notes}
                            onChange={e => setNewSubData(d => ({ ...d, notes: e.target.value }))}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              className="btn-primary"
                              onClick={handleSaveUserSub}
                              disabled={!newSubData.swap.trim()}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              <Check size={12} /> Save
                            </button>
                            <button
                              className="btn-ghost"
                              onClick={() => { setAddSubFor(null); setNewSubData({ swap: '', ratio: '', notes: '' }); }}
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              Cancel
                            </button>
                          </div>
                          <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
                            Saved swaps appear at the top whenever you click sub on <em>{original}</em> in any recipe.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {expanded && state?.error && (
                    <p className="ml-5 mt-2 text-xs no-print" style={{ color: 'var(--tomato)' }}>{state.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="md:col-span-2">
          <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
            <h2 className="display text-2xl">Method</h2>
            <div className="flex items-center gap-3 flex-wrap">
              {(() => {
                const total = totalStepDuration(displayedInstructions);
                const stepsWithoutDur = (recipe.instructions || []).filter(s => !getStepDuration(s)).length;
                const showEstimateBtn = stepsWithoutDur > 0 && !adaptedMethod;
                return (
                  <>
                    {total ? (
                      <span className="label" style={{ color: 'var(--ink-faint)' }}>
                        Total active · ~{formatStepDuration(total)}
                      </span>
                    ) : null}
                    {showEstimateBtn && (
                      <button
                        className="btn-ghost no-print"
                        onClick={handleEstimateTimes}
                        disabled={estimating}
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        title="Use AI to estimate active time per step"
                      >
                        {estimating ? <><Loader2 size={11} className="spinning" /> Estimating…</> : <><Sparkles size={11} /> Estimate times</>}
                      </button>
                    )}
                    {adaptedMethod && (
                      <span className="label" style={{ color: 'var(--tomato)' }}>Adapted · {formatQuantity(scale)}×</span>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          {estimateError && (
            <div className="mb-4 p-3 text-sm" style={{ background: 'rgba(179, 74, 44, 0.08)', border: '1px solid rgba(179, 74, 44, 0.3)', color: 'var(--tomato-deep)' }}>
              {estimateError}
            </div>
          )}
          <ol className="space-y-6">
            {displayedInstructions.map((step, i) => {
              const text = getStepText(step);
              const dur = getStepDuration(step);
              return (
                <li key={i} className="flex items-start gap-4">
                  <div style={{ minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span className="display text-3xl leading-none" style={{ color: 'var(--tomato)', fontWeight: 300 }}>
                      {i + 1}
                    </span>
                    {dur ? (
                      <span className="label" style={{ color: 'var(--ink-faint)', marginTop: 6, letterSpacing: '0.05em', fontSize: 10 }}>
                        ~{formatStepDuration(dur)}
                      </span>
                    ) : null}
                  </div>
                  <p style={{ lineHeight: 1.7, paddingTop: 4 }}>{text}</p>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      {recipe.notes && (
        <div className="mt-16 p-8" style={{ background: 'var(--paper-deep)', borderLeft: `3px solid var(--tomato)` }}>
          <p className="label mb-3">Notes</p>
          <p style={{ lineHeight: 1.7, color: 'var(--ink-soft)' }}>{recipe.notes}</p>
        </div>
      )}

      {/* Cook log */}
      <section className="mt-20 no-print">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="display text-3xl font-light">When I made it</h2>
          {!logFormOpen && (
            <button className="btn-ghost" onClick={() => setLogFormOpen(true)}>
              <MessageSquarePlus size={14} /> Add entry
            </button>
          )}
        </div>
        <p className="label mb-8">Your private cooking log — what worked, what didn't, photos of the result</p>

        {/* Stats panel */}
        {cookLog.length > 0 && <RecipeStats cookLog={cookLog} createdAt={recipe.created_at} />}

        {logFormOpen && (
          <LogEntryForm
            onCancel={() => setLogFormOpen(false)}
            onSave={handleAddLogEntry}
          />
        )}

        {cookLog.length === 0 && !logFormOpen ? (
          <div className="py-10 text-center" style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
            <p style={{ color: 'var(--ink-faint)' }}>No entries yet. Cook this recipe and tell future-you about it.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {cookLog.map(entry => (
              <LogEntry
                key={entry.id}
                entry={entry}
                onDelete={() => handleDeleteLogEntry(entry.id)}
                onPhotoClick={(src) => setLightbox(src)}
                onRate={(rating) => handleRateLogEntry(entry.id, rating)}
              />
            ))}
          </div>
        )}
      </section>

      {recipe.source_url && (
        <div className="mt-16 pt-8" style={{ borderTop: '1px solid var(--line)' }}>
          <p className="label mb-2">Originally from</p>
          <a href={recipe.source_url} target="_blank" rel="noreferrer" className="text-sm flex items-center gap-2" style={{ color: 'var(--ink-soft)' }}>
            <LinkIcon size={12} />
            <span className="truncate">{cleanUrl(recipe.source_url)}</span>
          </a>
        </div>
      )}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 12, 8, 0.92)', zIndex: 100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, cursor: 'pointer'
          }}
        >
          <img src={lightbox} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} alt="" />
        </div>
      )}
      {estimateReview && (
        <EstimateReviewModal
          review={estimateReview}
          onChange={(items) => setEstimateReview({ items })}
          onApply={applyEstimates}
          onCancel={() => setEstimateReview(null)}
        />
      )}
      {sendToFriendOpen && (
        <SendToFriendModal
          recipe={recipe}
          onClose={() => setSendToFriendOpen(false)}
        />
      )}
      {infoModal && (
        <IngredientInfoModal
          ingredient={infoModal.ingredient}
          state={infoState[infoModal.ingredient]}
          onClose={closeInfo}
        />
      )}
      </div>
    </div>
  );
}

// ---------- Log entry components ----------
function LogEntry({ entry, onDelete, onPhotoClick, onRate }) {
  return (
    <article className="fadein" style={{ paddingBottom: 32, borderBottom: '1px solid var(--line)' }}>
      <div className="flex items-start justify-between mb-3 gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar size={12} style={{ color: 'var(--ink-faint)' }} />
          <span className="label">{formatLogDate(entry.date)}</span>
          {entry.rating && (
            <span style={{ color: entry.rating === 'up' ? 'var(--olive)' : 'var(--tomato)' }}>
              {entry.rating === 'up' ? <ThumbsUp size={13} fill="currentColor" /> : <ThumbsDown size={13} fill="currentColor" />}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onRate && (
            <>
              <button
                onClick={() => onRate(entry.rating === 'up' ? null : 'up')}
                className="btn-ghost"
                style={{ padding: '4px 6px', color: entry.rating === 'up' ? 'var(--olive)' : 'var(--ink-faint)' }}
                title="Loved it"
              >
                <ThumbsUp size={12} fill={entry.rating === 'up' ? 'currentColor' : 'none'} />
              </button>
              <button
                onClick={() => onRate(entry.rating === 'down' ? null : 'down')}
                className="btn-ghost"
                style={{ padding: '4px 6px', color: entry.rating === 'down' ? 'var(--tomato)' : 'var(--ink-faint)' }}
                title="Wasn't great"
              >
                <ThumbsDown size={12} fill={entry.rating === 'down' ? 'currentColor' : 'none'} />
              </button>
            </>
          )}
          <button onClick={onDelete} className="btn-ghost" style={{ padding: '4px 8px', color: 'var(--ink-faint)' }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {entry.photo && (
        <img
          src={entry.photo}
          alt=""
          onClick={() => onPhotoClick(entry.photo)}
          style={{
            width: '100%', maxWidth: 480, maxHeight: 360, objectFit: 'cover',
            cursor: 'zoom-in', marginBottom: 16, display: 'block'
          }}
        />
      )}
      {entry.note && (
        <p style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{entry.note}</p>
      )}
    </article>
  );
}

function LogEntryForm({ onCancel, onSave }) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [date, setDate] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });

  const canSave = note.trim() || photo;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date: new Date(date + 'T12:00:00').getTime(),
      note: note.trim(),
      photo
    });
  };

  return (
    <div className="mb-10 p-6 fadein" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
      <div className="flex items-baseline justify-between mb-4">
        <p className="label">New entry</p>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="input"
          style={{ width: 'auto', fontSize: 13 }}
        />
      </div>

      {photo ? (
        <div className="relative mb-4 group" style={{ display: 'inline-block' }}>
          <img src={photo} alt="" style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'cover' }} />
          <button
            onClick={() => setPhoto(null)}
            className="absolute top-2 right-2 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'rgba(31, 24, 16, 0.85)', color: 'var(--paper)', borderRadius: 2 }}
          ><X size={14} /></button>
        </div>
      ) : (
        <label className="block mb-4 cursor-pointer text-sm" style={{ color: 'var(--ink-soft)' }}>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                const dataUrl = await compressImage(file);
                setPhoto(dataUrl);
              } catch (err) {
                alert('Could not load photo: ' + err.message);
              } finally {
                setUploading(false);
              }
            }}
          />
          <span className="flex items-center gap-2 hover:text-[var(--ink)] transition-colors">
            {uploading ? <><Loader2 size={14} className="spinning" /> Processing photo…</> : <><Camera size={14} /> Add a photo (optional)</>}
          </span>
        </label>
      )}

      <AutoGrowTextarea
        className="input"
        style={{ padding: '8px 0', lineHeight: 1.6 }}
        placeholder="Made this for the family — kids loved it. Use less pepper next time. Cooked an extra 5 min for a crispier top."
        minRows={3}
        value={note}
        onChange={e => setNote(e.target.value)}
      />

      <div className="flex items-center gap-3 mt-4">
        <button className="btn-primary" onClick={handleSave} disabled={!canSave}>
          <Check size={14} /> Save entry
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: 'var(--ink-faint)' }}>{icon}</span>
      <span className="label">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

// ---------- Cook Mode ----------
// Full-screen, hands-free cooking view. Big type, current step,
// ingredients sidebar, screen wake lock so it doesn't sleep.
function CookMode({ recipe, onExit }) {
  const [step, setStep] = useState(0);
  const [scale, setScale] = useState(1);
  const wakeLockRef = React.useRef(null);

  // Timers: array of { id, stepIndex, label, total, remaining, paused, fired }
  const [timers, setTimers] = useState([]);
  const [chimeFlash, setChimeFlash] = useState(false);

  // Completed steps (Set of step indices)
  const [completed, setCompleted] = useState(new Set());

  // Voice control
  const [voiceOn, setVoiceOn] = useState(false);
  const recognitionRef = React.useRef(null);

  // Mobile: ingredients drawer
  const [ingredientsOpen, setIngredientsOpen] = useState(false);

  const steps = recipe.instructions || [];
  const ingredients = useMemo(
    () => (recipe.ingredients || []).map(i => scale === 1 ? i : scaleIngredient(i, scale)),
    [recipe.ingredients, scale]
  );

  // Detect duration in current step — prefer stored duration_min, fall back to parsing prose
  const stepDuration = useMemo(() => {
    const stored = getStepDuration(steps[step]);
    if (stored) return stored * 60; // stored is in minutes; parseDuration returns seconds
    return parseDuration(getStepText(steps[step]));
  }, [steps, step]);

  // Timer tick — single interval, drives all active timers
  useEffect(() => {
    const hasRunning = timers.some(t => !t.paused && !t.fired);
    if (!hasRunning) return;
    const id = setInterval(() => {
      setTimers(ts => {
        let anyFired = false;
        const next = ts.map(t => {
          if (t.paused || t.fired) return t;
          const rem = t.remaining - 1;
          if (rem <= 0) {
            anyFired = true;
            return { ...t, remaining: 0, fired: true };
          }
          return { ...t, remaining: rem };
        });
        if (anyFired) {
          playChime();
          setChimeFlash(true);
          setTimeout(() => setChimeFlash(false), 2500);
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timers]);

  const startTimer = (durationOverride) => {
    const dur = durationOverride || stepDuration;
    if (!dur) return;
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setTimers(ts => [...ts, {
      id,
      stepIndex: step,
      label: `Step ${step + 1}`,
      total: dur,
      remaining: dur,
      paused: false,
      fired: false
    }]);
  };
  const togglePauseTimer = (id) => {
    setTimers(ts => ts.map(t => t.id === id && !t.fired ? { ...t, paused: !t.paused } : t));
  };
  const dismissTimer = (id) => {
    setTimers(ts => ts.filter(t => t.id !== id));
  };
  const addTimerTime = (id, secondsToAdd) => {
    setTimers(ts => ts.map(t => t.id === id ? {
      ...t,
      total: t.total + secondsToAdd,
      remaining: (t.fired ? 0 : t.remaining) + secondsToAdd,
      fired: false,
      paused: false
    } : t));
  };

  const toggleStepComplete = (idx) => {
    setCompleted(c => {
      const next = new Set(c);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const goNext = () => setStep(s => Math.min(steps.length - 1, s + 1));
  const goPrev = () => setStep(s => Math.max(0, s - 1));

  // Voice control via Web Speech API
  useEffect(() => {
    if (!voiceOn) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      alert("Voice control isn't supported in this browser. Try Chrome or Edge.");
      setVoiceOn(false);
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      const transcript = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
      if (/(next|forward|advance)/.test(transcript)) goNext();
      else if (/(previous|back|prior|prev)/.test(transcript)) goPrev();
      else if (/(start timer|begin timer|set timer)/.test(transcript)) startTimer();
      else if (/(pause)/.test(transcript)) {
        const running = timers.find(t => !t.paused && !t.fired);
        if (running) togglePauseTimer(running.id);
      }
      else if (/(resume|continue)/.test(transcript)) {
        const paused = timers.find(t => t.paused && !t.fired);
        if (paused) togglePauseTimer(paused.id);
      }
      else if (/(complete|done|mark done)/.test(transcript)) toggleStepComplete(step);
      else if (/(exit|quit|close)/.test(transcript)) onExit();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed') {
        alert('Microphone access denied. Enable it in your browser settings to use voice control.');
        setVoiceOn(false);
      }
    };
    rec.onend = () => {
      // Auto-restart while voice is on
      if (voiceOn && recognitionRef.current === rec) {
        try { rec.start(); } catch {}
      }
    };
    try { rec.start(); } catch {}
    recognitionRef.current = rec;

    return () => {
      try { rec.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, [voiceOn]);

  // Keep screen awake while in cook mode
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      try {
        if ('wakeLock' in navigator) {
          const lock = await navigator.wakeLock.request('screen');
          if (cancelled) { lock.release(); return; }
          wakeLockRef.current = lock;
        }
      } catch { /* not supported / denied — silent */ }
    }
    acquire();

    const onVis = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) acquire();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        goPrev();
      } else if (e.key === 'Escape') {
        onExit();
      } else if (e.key === 'Enter') {
        toggleStepComplete(step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps.length, onExit, step]);

  if (steps.length === 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <p style={{ color: 'var(--ink-soft)' }}>No steps to cook from.</p>
        <button className="btn-primary" onClick={onExit}>Back to recipe</button>
      </div>
    );
  }

  const isStepComplete = completed.has(step);
  const nextStepText = step < steps.length - 1 ? getStepText(steps[step + 1]) : null;
  const allDone = completed.size === steps.length;

  return (
    <div className="fadein" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <header style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn-ghost" onClick={onExit}>
          <X size={16} /> Exit
        </button>
        <div className="hidden md:block display text-xl" style={{ fontWeight: 400, flex: 1, textAlign: 'center', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {recipe.title}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setIngredientsOpen(true)}
            className="btn-ghost cook-ingredients-toggle"
            title="Show ingredients"
          >
            <ChefHat size={14} /> Ingredients
          </button>
          <button
            onClick={() => setVoiceOn(!voiceOn)}
            className="btn-ghost"
            style={{ color: voiceOn ? 'var(--tomato)' : 'var(--ink-soft)' }}
            title={voiceOn ? 'Turn off voice control' : 'Turn on voice control'}
          >
            {voiceOn ? <Mic size={14} className="pulse-dot" /> : <MicOff size={14} />}
            <span className="hidden md:inline">{voiceOn ? 'Listening' : 'Voice'}</span>
          </button>
          {SCALE_PRESETS.filter(p => [0.5, 1, 2].includes(p.value)).map(p => (
            <button
              key={p.value}
              className={`tag-chip ${Math.abs(scale - p.value) < 0.001 ? 'active' : ''}`}
              onClick={() => setScale(p.value)}
            >{p.label}</button>
          ))}
        </div>
      </header>

      {/* Active timers strip — pinned, shows timers from OTHER steps (current step's timer is shown inline) */}
      {timers.filter(t => t.stepIndex !== step).length > 0 && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', background: 'var(--paper-deep)', display: 'flex', gap: 8, overflowX: 'auto', flexWrap: 'nowrap' }}>
          {timers.filter(t => t.stepIndex !== step).map(t => (
            <TimerChip
              key={t.id}
              timer={t}
              onTogglePause={() => togglePauseTimer(t.id)}
              onDismiss={() => dismissTimer(t.id)}
              onAddTime={(secs) => addTimerTime(t.id, secs)}
              onJumpToStep={() => setStep(t.stepIndex)}
            />
          ))}
        </div>
      )}

      {/* Main */}
      <div className="cook-grid">
        {/* Ingredient sidebar (always visible on desktop, drawer on mobile) */}
        <aside className="cook-sidebar" style={{ padding: '24px 20px', borderRight: '1px solid var(--line)', maxHeight: 'calc(100vh - 73px)', overflowY: 'auto', background: 'var(--paper-deep)' }}>
          <p className="label mb-4">Ingredients{scale !== 1 && ` · ${formatQuantity(scale)}×`}</p>
          <ul className="space-y-3">
            {ingredients.map((ing, i) => {
              if (isIngredientSection(ing)) {
                return (
                  <li key={i} className="pt-2 first:pt-0">
                    <h3 className="label" style={{ color: 'var(--tomato)', letterSpacing: '0.18em' }}>
                      {cleanSectionLabel(ing)}
                    </h3>
                  </li>
                );
              }
              const isActive = isIngredientInStep(ing, getStepText(steps[step]));
              return (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm"
                  style={{
                    lineHeight: 1.5,
                    padding: isActive ? '4px 8px' : '0',
                    marginLeft: isActive ? '-8px' : '0',
                    background: isActive ? 'rgba(179, 74, 44, 0.1)' : 'transparent',
                    borderLeft: isActive ? '2px solid var(--tomato)' : '2px solid transparent',
                    color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
                    fontWeight: isActive ? 500 : 400,
                    transition: 'all 0.2s'
                  }}
                >
                  <span style={{ color: 'var(--tomato)', flexShrink: 0, fontWeight: isActive ? 700 : 400 }}>·</span>
                  <span>{ing}</span>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Step area */}
        <section style={{ padding: '36px 24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 'calc(100vh - 73px)' }}>
          <div style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <div className="label">Step {step + 1} of {steps.length}</div>
              {(() => {
                const dur = getStepDuration(steps[step]);
                return dur ? (
                  <span className="label" style={{ color: 'var(--ink-faint)', letterSpacing: '0.05em' }}>
                    · ~{formatStepDuration(dur)}
                  </span>
                ) : null;
              })()}
              <button
                onClick={() => toggleStepComplete(step)}
                className="flex items-center gap-2"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: isStepComplete ? 'var(--olive)' : 'var(--ink-faint)',
                  fontFamily: 'inherit', fontSize: 11, letterSpacing: '0.18em',
                  textTransform: 'uppercase', padding: 0,
                  marginLeft: 'auto'
                }}
              >
                {isStepComplete ? <CheckSquare size={14} /> : <Square size={14} />}
                {isStepComplete ? 'Done' : 'Mark done'}
              </button>
            </div>
            <p
              className="display"
              style={{
                fontSize: 'clamp(26px, 4.2vw, 44px)',
                lineHeight: 1.35,
                fontWeight: 300,
                letterSpacing: '-0.01em',
                color: isStepComplete ? 'var(--ink-faint)' : 'var(--ink)',
                textDecoration: isStepComplete ? 'line-through' : 'none',
                transition: 'all 0.2s'
              }}
            >
              {getStepSegments(getStepText(steps[step]), ingredients).map((seg, i) => {
                if (seg.type === 'text') return seg.text;
                return (
                  <span key={i} style={{ whiteSpace: 'nowrap' }}>
                    {seg.text}
                    <span
                      style={{
                        color: 'var(--tomato)',
                        fontSize: '0.55em',
                        fontWeight: 500,
                        marginLeft: 6,
                        verticalAlign: 'baseline',
                        letterSpacing: '0',
                        whiteSpace: 'nowrap',
                        fontFamily: "'DM Sans', sans-serif"
                      }}
                    >
                      {seg.amount}
                    </span>
                  </span>
                );
              })}
            </p>

            {/* Per-step inline timer — big and tappable, shows next to the step it belongs to */}
            {(() => {
              const stepTimers = timers.filter(t => t.stepIndex === step);
              const hasActiveOrFiredTimer = stepTimers.length > 0;
              return (
                <div className="mt-8 fadein">
                  {stepTimers.map(t => (
                    <InlineTimer
                      key={t.id}
                      timer={t}
                      onTogglePause={() => togglePauseTimer(t.id)}
                      onDismiss={() => dismissTimer(t.id)}
                      onAddTime={(secs) => addTimerTime(t.id, secs)}
                    />
                  ))}
                  {/* Only show "Start timer" when no active timer for this step (or "another" if a fired timer exists) */}
                  {stepDuration && !stepTimers.some(t => !t.fired) && (
                    <button
                      onClick={() => startTimer()}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--line)',
                        padding: '12px 20px',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        color: 'var(--ink-soft)',
                        display: 'inline-flex', alignItems: 'center', gap: 10,
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--ink)'; e.currentTarget.style.color = 'var(--ink)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--ink-soft)'; }}
                    >
                      <Timer size={16} />
                      Start {hasActiveOrFiredTimer ? 'another ' : ''}timer · {formatTimerLabel(stepDuration)}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Next-step preview */}
            {nextStepText && (
              <div
                onClick={goNext}
                className="mt-12 p-4 cursor-pointer group"
                style={{
                  background: 'transparent',
                  borderTop: '1px solid var(--line)',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--paper-deep)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <p className="label mb-2" style={{ color: 'var(--ink-faint)' }}>Coming up · Step {step + 2}</p>
                <p
                  className="text-sm"
                  style={{
                    color: 'var(--ink-faint)',
                    lineHeight: 1.6,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}
                >
                  {nextStepText}
                </p>
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ maxWidth: 720, margin: '40px auto 0', width: '100%' }}>
            {/* Progress dots — show completion */}
            <div className="flex items-center gap-2 justify-center mb-6 flex-wrap">
              {steps.map((_, i) => {
                const isDone = completed.has(i);
                const isCurrent = i === step;
                return (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    style={{
                      width: isCurrent ? 24 : 8,
                      height: 8,
                      borderRadius: 100,
                      background: isDone ? 'var(--olive)' : (i <= step ? 'var(--tomato)' : 'var(--line)'),
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      padding: 0
                    }}
                    aria-label={`Go to step ${i + 1}${isDone ? ' (done)' : ''}`}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                className="btn-ghost"
                onClick={goPrev}
                disabled={step === 0}
                style={{ opacity: step === 0 ? 0.3 : 1 }}
              >
                <ChevronLeft size={16} /> Previous
              </button>
              {step < steps.length - 1 ? (
                <button
                  className="btn-primary"
                  onClick={goNext}
                  style={{ padding: '14px 28px', fontSize: 16 }}
                >
                  Next step <ChevronRight size={18} />
                </button>
              ) : (
                <button
                  className="btn-primary"
                  onClick={onExit}
                  style={{ padding: '14px 28px', fontSize: 16, background: allDone ? 'var(--olive)' : 'var(--tomato)' }}
                >
                  <Check size={18} /> {allDone ? 'All done — exit' : 'Done cooking'}
                </button>
              )}
            </div>
            <p className="text-xs text-center mt-4" style={{ color: 'var(--ink-faint)' }}>
              {voiceOn
                ? '🎙 Listening — say "next", "previous", "start timer", "pause", "done"'
                : 'Tip: arrow keys to navigate, Enter to mark done, Esc to exit'}
            </p>
          </div>
        </section>
      </div>

      {/* Mobile ingredients drawer */}
      {ingredientsOpen && (
        <div
          onClick={() => setIngredientsOpen(false)}
          className="cook-drawer-backdrop"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 12, 8, 0.6)',
            zIndex: 50, backdropFilter: 'blur(4px)'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="fadein"
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0,
              background: 'var(--paper)',
              maxHeight: '70vh', overflowY: 'auto',
              padding: '24px 24px 32px',
              borderTopLeftRadius: 12, borderTopRightRadius: 12,
              boxShadow: '0 -8px 32px rgba(0,0,0,0.2)'
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="label">Ingredients{scale !== 1 && ` · ${formatQuantity(scale)}×`}</p>
              <button onClick={() => setIngredientsOpen(false)} className="btn-ghost" style={{ padding: 6 }}>
                <X size={16} />
              </button>
            </div>
            <ul className="space-y-3">
              {ingredients.map((ing, i) => {
                if (isIngredientSection(ing)) {
                  return (
                    <li key={i} className="pt-2 first:pt-0">
                      <h3 className="label" style={{ color: 'var(--tomato)', letterSpacing: '0.18em' }}>
                        {cleanSectionLabel(ing)}
                      </h3>
                    </li>
                  );
                }
                return (
                  <li key={i} className="flex items-start gap-2 text-sm" style={{ lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--tomato)', flexShrink: 0 }}>·</span>
                    <span>{ing}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {chimeFlash && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0,
            padding: '16px 24px',
            background: 'var(--tomato)',
            color: 'var(--paper)',
            textAlign: 'center',
            zIndex: 100,
            fontFamily: 'inherit',
            fontSize: 16,
            fontWeight: 500,
            letterSpacing: '0.05em'
          }}
          className="fadein"
        >
          ⏰ Timer's up!
        </div>
      )}
    </div>
  );
}

// Small inline timer chip used in the active-timers strip
// Big inline timer card — shown in the step area for the current step's active timer.
// Designed to be visible while cooking from a few feet away. Big mono digits, large
// touch-friendly buttons (44px+ min height per iOS HIG), +1m/+5m to extend, clear cancel.
function InlineTimer({ timer, onTogglePause, onDismiss, onAddTime }) {
  const isFired = timer.fired;
  const buttonStyle = {
    minHeight: 44,
    padding: '10px 14px',
    fontSize: 13,
    fontFamily: 'inherit',
    fontWeight: 500,
    background: 'transparent',
    border: `1px solid ${isFired ? 'var(--paper)' : 'var(--ink)'}`,
    color: 'inherit',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    WebkitTapHighlightColor: 'rgba(255,255,255,0.2)',
    touchAction: 'manipulation',
    transition: 'opacity 0.15s'
  };
  return (
    <div
      style={{
        background: isFired ? 'var(--tomato)' : 'var(--paper-deep)',
        color: isFired ? 'var(--paper)' : 'var(--ink)',
        padding: '20px 24px',
        border: `1px solid ${isFired ? 'var(--tomato)' : 'var(--line)'}`,
        animation: isFired ? 'pulse-warn 1.5s ease-in-out infinite' : 'none',
        marginBottom: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div className="label" style={{ color: 'inherit', opacity: 0.7, letterSpacing: '0.18em' }}>
          {isFired ? "Time's up" : timer.label}
          {timer.paused && !isFired && ' · paused'}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 40,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 300,
            letterSpacing: '-0.02em',
            opacity: timer.paused ? 0.5 : 1,
            lineHeight: 1
          }}
        >
          {isFired ? 'DONE' : formatTimerDisplay(timer.remaining)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!isFired && (
          <button onClick={onTogglePause} style={buttonStyle} title={timer.paused ? 'Resume' : 'Pause'}>
            {timer.paused ? <Play size={14} /> : <Pause size={14} />}
            {timer.paused ? 'Resume' : 'Pause'}
          </button>
        )}
        <button onClick={() => onAddTime(60)} style={buttonStyle} title="Add 1 minute">
          +1 min
        </button>
        <button onClick={() => onAddTime(300)} style={buttonStyle} title="Add 5 minutes">
          +5 min
        </button>
        <button
          onClick={onDismiss}
          style={{
            ...buttonStyle,
            background: isFired ? 'var(--paper)' : 'transparent',
            color: isFired ? 'var(--tomato)' : 'inherit',
            marginLeft: 'auto'
          }}
          title={isFired ? 'Dismiss' : 'Cancel timer'}
        >
          <X size={14} />
          {isFired ? 'Dismiss' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

// Compact timer chip for the top strip — shows timers from OTHER steps so you can
// track parallel cooking. Tap the label to jump to that step. Bigger touch targets
// than the previous version, with +time and proper-size cancel.
function TimerChip({ timer, onTogglePause, onDismiss, onAddTime, onJumpToStep }) {
  const isFired = timer.fired;
  const iconBtnStyle = {
    minWidth: 32,
    minHeight: 32,
    padding: 4,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'rgba(0,0,0,0.1)',
    touchAction: 'manipulation'
  };
  const addBtnStyle = {
    minHeight: 32,
    padding: '4px 8px',
    fontSize: 11,
    fontFamily: 'inherit',
    fontWeight: 500,
    background: 'transparent',
    border: `1px solid ${isFired ? 'var(--paper)' : 'var(--line)'}`,
    color: 'inherit',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'rgba(0,0,0,0.1)',
    touchAction: 'manipulation'
  };
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 6px 6px 12px',
        background: isFired ? 'var(--tomato)' : 'var(--paper)',
        color: isFired ? 'var(--paper)' : 'var(--ink)',
        border: `1px solid ${isFired ? 'var(--tomato)' : 'var(--line)'}`,
        borderRadius: 100,
        flexShrink: 0,
        animation: isFired ? 'pulse-warn 1s ease-in-out infinite' : 'none'
      }}
    >
      <button
        onClick={onJumpToStep}
        title="Go to this step"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: '4px 0',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'inherit'
        }}
      >
        <Timer size={12} />
        <span className="label" style={{ color: 'inherit', letterSpacing: '0.05em' }}>{timer.label}</span>
        <span
          className="mono"
          style={{
            fontSize: 13,
            fontVariantNumeric: 'tabular-nums',
            minWidth: 50,
            textAlign: 'right',
            opacity: timer.paused ? 0.5 : 1
          }}
        >
          {isFired ? 'DONE' : formatTimerDisplay(timer.remaining)}
        </span>
      </button>
      <button onClick={() => onAddTime(60)} style={addBtnStyle} title="Add 1 minute">+1m</button>
      {!isFired && (
        <button onClick={onTogglePause} style={iconBtnStyle} title={timer.paused ? 'Resume' : 'Pause'}>
          {timer.paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      )}
      <button onClick={onDismiss} style={iconBtnStyle} title="Dismiss" aria-label="Dismiss timer">
        <X size={16} />
      </button>
    </div>
  );
}

// ---------- Journal / Timeline View ----------
function JournalView({ entries, recipes, onOpenRecipe, onBackToCookbook }) {
  const stats = useMemo(() => {
    const now = Date.now();
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
    const recent = entries.filter(e => (e.date || 0) > monthAgo);
    const uniqueRecent = new Set(recent.map(e => e.recipeId)).size;
    return { lastMonth: recent.length, unique: uniqueRecent, total: entries.length };
  }, [entries]);

  return (
    <div className="max-w-3xl mx-auto px-8 py-12 fadein">
      <header className="mb-12">
        <div className="label mb-3">Cooking journal</div>
        <h1 className="display text-5xl md:text-6xl font-light leading-none mb-6">
          What I've <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>made</em>
        </h1>
        {entries.length > 0 && (
          <div className="flex flex-wrap gap-x-10 gap-y-3 mt-8 pt-6" style={{ borderTop: '1px solid var(--line)' }}>
            <div>
              <div className="display text-3xl">{stats.lastMonth}</div>
              <div className="label">Last 30 days</div>
            </div>
            <div>
              <div className="display text-3xl">{stats.unique}</div>
              <div className="label">Unique recipes</div>
            </div>
            <div>
              <div className="display text-3xl">{stats.total}</div>
              <div className="label">All time</div>
            </div>
          </div>
        )}
      </header>

      {entries.length === 0 ? (
        <div className="text-center py-24 max-w-md mx-auto">
          <History className="mx-auto mb-6" size={32} style={{ color: 'var(--ink-faint)' }} />
          <p className="display text-2xl mb-3 italic" style={{ color: 'var(--ink-soft)' }}>No entries yet.</p>
          <p className="mb-8" style={{ color: 'var(--ink-faint)' }}>
            When you cook a recipe, add a log entry on the recipe page. Photos and notes will show up here, newest first.
          </p>
          <button className="btn-primary" onClick={onBackToCookbook}>
            <BookOpen size={14} /> Browse cookbook
          </button>
        </div>
      ) : (
        <div className="space-y-12 stagger">
          {entries.map(entry => (
            <article key={entry.id} className="fadein" style={{ paddingBottom: 32, borderBottom: '1px solid var(--line)' }}>
              <div className="flex items-baseline gap-3 mb-3 flex-wrap">
                <span className="label flex items-center gap-2">
                  <Calendar size={11} /> {formatLogDate(entry.date)}
                </span>
                <span style={{ color: 'var(--ink-faint)' }}>·</span>
                <button
                  className="display text-xl"
                  onClick={() => onOpenRecipe(entry.recipeId)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    color: 'var(--ink)', transition: 'color 0.2s', fontWeight: 400
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--tomato)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--ink)'}
                >
                  {entry.recipeTitle}
                </button>
              </div>
              {entry.photo && (
                <img
                  src={entry.photo}
                  alt=""
                  style={{
                    width: '100%', maxWidth: 540, maxHeight: 380, objectFit: 'cover',
                    marginBottom: 16, display: 'block', cursor: 'pointer'
                  }}
                  onClick={() => onOpenRecipe(entry.recipeId)}
                />
              )}
              {entry.note && <p style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap', maxWidth: 640 }}>{entry.note}</p>}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Shopping View ----------
function ShoppingView({ shoppingList, setShoppingList, recipes, onOpenRecipe, onBackToCookbook, plan, requireFeature, bumpUsage, pantry, onMoveToPantry }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [moveStatus, setMoveStatus] = useState(null);

  const isEmpty = !shoppingList.recipes || shoppingList.recipes.length === 0;
  const isStale = shoppingList.recipes?.length > 0 && (!shoppingList.generated_at || (shoppingList.items || []).length === 0);

  const handleGenerate = async () => {
    if (isEmpty) return;
    if (requireFeature && !requireFeature('shopping_consolidate')) return;
    setGenerating(true);
    setError(null);
    try {
      const items = await consolidateShoppingList(shoppingList.recipes);
      if (bumpUsage) await bumpUsage('shopping_consolidate');
      const next = { ...shoppingList, items, generated_at: Date.now() };
      await storage.saveShoppingList(next);
      setShoppingList(next);
    } catch (e) {
      setError(e.message || 'Could not generate list');
    } finally {
      setGenerating(false);
    }
  };

  const handleRemoveRecipe = async (recipeId) => {
    const next = {
      ...shoppingList,
      recipes: shoppingList.recipes.filter(r => r.id !== recipeId),
      items: [],
      generated_at: null
    };
    await storage.saveShoppingList(next);
    setShoppingList(next);
  };

  const handleToggleItem = async (itemId) => {
    const next = {
      ...shoppingList,
      items: shoppingList.items.map(it => it.id === itemId ? { ...it, checked: !it.checked } : it)
    };
    await storage.saveShoppingList(next);
    setShoppingList(next);
  };

  const [confirmClear, setConfirmClear] = useState(false);
  const handleClearAll = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    const next = { recipes: [], items: [], generated_at: null };
    await storage.saveShoppingList(next);
    setShoppingList(next);
    setConfirmClear(false);
  };

  const handleClearChecked = async () => {
    const next = { ...shoppingList, items: shoppingList.items.filter(it => !it.checked) };
    await storage.saveShoppingList(next);
    setShoppingList(next);
  };

  // Group items by category
  const grouped = useMemo(() => {
    const groups = {};
    (shoppingList.items || []).forEach(item => {
      const cat = item.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return groups;
  }, [shoppingList.items]);

  const categoryOrder = ['produce', 'meat-seafood', 'dairy', 'bakery', 'pantry', 'baking', 'spices', 'frozen', 'beverages', 'other'];
  const categoryLabels = {
    'produce': 'Produce',
    'meat-seafood': 'Meat & Seafood',
    'dairy': 'Dairy',
    'bakery': 'Bakery',
    'pantry': 'Pantry',
    'baking': 'Baking',
    'spices': 'Spices',
    'frozen': 'Frozen',
    'beverages': 'Beverages',
    'other': 'Other'
  };

  const totalItems = (shoppingList.items || []).length;
  const checkedCount = (shoppingList.items || []).filter(it => it.checked).length;

  const handleCopyList = async () => {
    let out = `SHOPPING LIST\n=============\n\n`;
    categoryOrder.forEach(cat => {
      if (!grouped[cat]) return;
      out += `${categoryLabels[cat].toUpperCase()}\n`;
      grouped[cat].forEach(it => {
        const name = it.prep ? `${it.name}, ${it.prep}` : it.name;
        out += `  ${it.checked ? '✓' : '☐'} ${it.amount} ${name}\n`;
      });
      out += '\n';
    });
    out += `\nFor: ${shoppingList.recipes.map(r => r.title).join(', ')}`;
    await navigator.clipboard.writeText(out);
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-12 fadein">
      <header className="mb-10">
        <div className="label mb-3">Shopping list</div>
        <div className="flex items-baseline justify-between flex-wrap gap-4">
          <h1 className="display text-5xl md:text-6xl font-light leading-none">
            <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>Groceries</em>
          </h1>
          {!isEmpty && (
            <div className="flex items-center gap-2 flex-wrap">
              {totalItems > 0 && (
                <button className="btn-ghost" onClick={handleCopyList}>
                  <Copy size={14} /> Copy list
                </button>
              )}
              {checkedCount > 0 && onMoveToPantry && (
                <button
                  className="btn-ghost"
                  onClick={async () => {
                    const added = await onMoveToPantry();
                    setMoveStatus(`Added ${added} ${added === 1 ? 'item' : 'items'} to your pantry.`);
                    setTimeout(() => setMoveStatus(null), 4000);
                  }}
                  style={{ color: 'var(--olive)' }}
                  title="Move checked items to your pantry"
                >
                  <Refrigerator size={14} /> Restock pantry ({checkedCount})
                </button>
              )}
              {checkedCount > 0 && (
                <button className="btn-ghost" onClick={handleClearChecked}>
                  Clear ✓ ({checkedCount})
                </button>
              )}
              <button className="btn-ghost" onClick={handleClearAll} style={{ color: confirmClear ? 'var(--paper)' : 'var(--tomato)', background: confirmClear ? 'var(--tomato)' : 'transparent', padding: '6px 12px' }}>
                <Trash2 size={14} /> {confirmClear ? 'Tap again to confirm' : 'Clear all'}
              </button>
            </div>
          )}
        </div>
      </header>

      {moveStatus && (
        <div className="mb-6 p-3 fadein flex items-center gap-2" style={{ background: 'rgba(107, 98, 51, 0.1)', border: '1px solid var(--olive)' }}>
          <Check size={14} style={{ color: 'var(--olive)' }} />
          <p className="text-sm" style={{ color: 'var(--olive)' }}>{moveStatus}</p>
        </div>
      )}

      {isEmpty ? (
        <div className="text-center py-24 max-w-md mx-auto">
          <ShoppingBasket className="mx-auto mb-6" size={32} style={{ color: 'var(--ink-faint)' }} />
          <p className="display text-2xl mb-3 italic" style={{ color: 'var(--ink-soft)' }}>An empty list.</p>
          <p className="mb-8" style={{ color: 'var(--ink-faint)' }}>
            Open a recipe and tap "Add to list." Once you've added a few, generate a consolidated grocery list grouped by aisle.
          </p>
          <button className="btn-primary" onClick={onBackToCookbook}>
            <BookOpen size={14} /> Browse cookbook
          </button>
        </div>
      ) : (
        <>
          {/* Recipes in this list */}
          <section className="mb-10">
            <p className="label mb-4">Recipes ({shoppingList.recipes.length})</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {shoppingList.recipes.map(r => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 p-3 group"
                  style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}
                >
                  {r.hero_image && (
                    <img
                      src={r.hero_image}
                      alt=""
                      style={{ width: 50, height: 50, objectFit: 'cover', flexShrink: 0 }}
                      onError={e => e.currentTarget.style.display = 'none'}
                    />
                  )}
                  <button
                    onClick={() => onOpenRecipe(recipes.find(x => x.id === r.id))}
                    className="flex-1 text-left"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 0 }}
                  >
                    <div className="text-sm truncate" style={{ color: 'var(--ink)' }}>{r.title}</div>
                    {r.scale !== 1 && (
                      <div className="label" style={{ marginTop: 2 }}>Scaled {formatQuantity(r.scale)}×</div>
                    )}
                  </button>
                  <button
                    onClick={() => handleRemoveRecipe(r.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    style={{ color: 'var(--ink-faint)' }}
                    title="Remove from list"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Generate / regenerate */}
          {(isStale || totalItems === 0) && (
            <div className="mb-10 p-6 fadein" style={{ background: 'rgba(179, 74, 44, 0.05)', border: '1px solid rgba(179, 74, 44, 0.25)' }}>
              <p className="label mb-2">{totalItems === 0 ? 'Ready to generate' : 'List is out of date'}</p>
              <p className="text-sm mb-4" style={{ color: 'var(--ink-soft)' }}>
                {totalItems === 0
                  ? 'Combine ingredients across all recipes into a single shopping list grouped by aisle.'
                  : 'You changed which recipes are in the list. Regenerate to update the consolidated items.'}
              </p>
              <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
                {generating ? <><Loader2 size={14} className="spinning" /> Consolidating ingredients…</> : <><Sparkles size={14} /> {totalItems === 0 ? 'Generate list' : 'Regenerate'}</>}
              </button>
              {error && (
                <p className="text-xs mt-3" style={{ color: 'var(--tomato)' }}>{error}</p>
              )}
            </div>
          )}

          {/* Items grouped by category */}
          {totalItems > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-6">
                <p className="label">{checkedCount} of {totalItems} checked</p>
                <p className="label">Generated {formatLogDate(shoppingList.generated_at)}</p>
              </div>

              {categoryOrder.map(cat => {
                if (!grouped[cat]) return null;
                return (
                  <div key={cat} className="mb-8">
                    <h2 className="display text-xl mb-3" style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>
                      {categoryLabels[cat]}
                    </h2>
                    <ul className="space-y-2">
                      {grouped[cat].map(it => (
                        <li
                          key={it.id}
                          className="flex items-start gap-3 py-2"
                          style={{ borderBottom: '1px solid var(--line)' }}
                        >
                          <button
                            className={`checkbox ${it.checked ? 'checked' : ''}`}
                            onClick={() => handleToggleItem(it.id)}
                            style={{ marginTop: 2 }}
                          >
                            {it.checked && <Check size={12} />}
                          </button>
                          <div style={{ flex: 1, minWidth: 0, opacity: it.checked ? 0.4 : 1, textDecoration: it.checked ? 'line-through' : 'none' }}>
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <span className="text-sm" style={{ fontWeight: 500 }}>{it.amount}</span>
                              <span className="text-sm">{it.name}</span>
                              {it.prep && <span className="text-xs" style={{ color: 'var(--ink-faint)', fontStyle: 'italic' }}>· {it.prep}</span>}
                            </div>
                            {it.sources && it.sources.length > 0 && (
                              <div className="text-xs mt-1" style={{ color: 'var(--ink-faint)' }}>
                                for {it.sources.join(', ')}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Plan View (Meal Planner) ----------
function PlanView({ mealPlan, setMealPlan, recipes, shoppingList, setShoppingList, onOpenRecipe, onLogCooked, plan, requireFeature }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [pickerOpen, setPickerOpen] = useState(null); // { date, meal } or null
  const [pickerSearch, setPickerSearch] = useState('');
  const [logPrompt, setLogPrompt] = useState(null); // { date, meal, slot } for cook-log prompt

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const today = isoDate(new Date());

  const handleAssign = async (date, meal, recipe) => {
    const dateKey = isoDate(date);
    const existing = mealPlan.days[dateKey] || {};
    const next = {
      ...mealPlan,
      days: {
        ...mealPlan.days,
        [dateKey]: {
          ...existing,
          [meal]: {
            recipeId: recipe.id,
            recipeTitle: recipe.title,
            scale: 1,
            hero_image: recipe.hero_image || null,
            cooked: false
          }
        }
      }
    };
    await storage.saveMealPlan(next);
    setMealPlan(next);
    setPickerOpen(null);
    setPickerSearch('');
  };

  const handleClearSlot = async (date, meal) => {
    const dateKey = isoDate(date);
    const existing = mealPlan.days[dateKey] || {};
    const updated = { ...existing };
    delete updated[meal];
    const next = {
      ...mealPlan,
      days: {
        ...mealPlan.days,
        [dateKey]: updated
      }
    };
    await storage.saveMealPlan(next);
    setMealPlan(next);
  };

  const handleMarkCooked = (date, meal, slot) => {
    setLogPrompt({ date, meal, slot });
  };

  const handleConfirmCooked = async (note) => {
    if (!logPrompt) return;
    const { date, meal, slot } = logPrompt;
    await onLogCooked(slot.recipeId, date, note);
    // Mark on the plan
    const dateKey = date;
    const existing = mealPlan.days[dateKey] || {};
    const next = {
      ...mealPlan,
      days: {
        ...mealPlan.days,
        [dateKey]: {
          ...existing,
          [meal]: { ...existing[meal], cooked: true }
        }
      }
    };
    await storage.saveMealPlan(next);
    setMealPlan(next);
    setLogPrompt(null);
  };

  const handleSendToShopping = async () => {
    if (requireFeature && !requireFeature('meal_plan_send_to_shopping')) return;
    // Collect every recipe scheduled this week, dedupe by id
    const seen = new Set(shoppingList.recipes.map(r => r.id));
    const newRecipes = [...shoppingList.recipes];
    let added = 0;
    days.forEach(d => {
      const dayPlan = mealPlan.days[isoDate(d)];
      if (!dayPlan) return;
      ['breakfast', 'lunch', 'dinner'].forEach(m => {
        const slot = dayPlan[m];
        if (!slot || seen.has(slot.recipeId)) return;
        const recipe = recipes.find(r => r.id === slot.recipeId);
        if (!recipe) return;
        const scale = slot.scale || 1;
        newRecipes.push({
          id: recipe.id,
          title: recipe.title,
          scale,
          ingredients: (recipe.ingredients || []).map(i => scale === 1 ? i : scaleIngredient(i, scale)),
          hero_image: recipe.hero_image || null
        });
        seen.add(slot.recipeId);
        added++;
      });
    });
    const next = {
      ...shoppingList,
      recipes: newRecipes,
      generated_at: null,
      items: []
    };
    await storage.saveShoppingList(next);
    setShoppingList(next);
    alert(`Added ${added} ${added === 1 ? 'recipe' : 'recipes'} to your shopping list. Head to Shopping to generate the consolidated grocery list.`);
  };

  const weekMealCount = useMemo(() => {
    let count = 0;
    days.forEach(d => {
      const dayPlan = mealPlan.days[isoDate(d)];
      if (dayPlan) {
        ['breakfast', 'lunch', 'dinner'].forEach(m => { if (dayPlan[m]) count++; });
      }
    });
    return count;
  }, [days, mealPlan]);

  const filteredPickerRecipes = useMemo(() => {
    if (!pickerSearch.trim()) return recipes;
    const q = pickerSearch.toLowerCase();
    return recipes.filter(r => r.title?.toLowerCase().includes(q));
  }, [recipes, pickerSearch]);

  return (
    <div className="max-w-5xl mx-auto px-8 py-12 fadein">
      <header className="mb-10">
        <div className="label mb-3">Meal plan</div>
        <div className="flex items-baseline justify-between flex-wrap gap-4">
          <h1 className="display text-5xl md:text-6xl font-light leading-none">
            <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>The week ahead</em>
          </h1>
          {weekMealCount > 0 && (
            <button className="btn-primary" onClick={handleSendToShopping}>
              <ShoppingBasket size={14} /> Send {weekMealCount} {weekMealCount === 1 ? 'meal' : 'meals'} to shopping
            </button>
          )}
        </div>
      </header>

      {/* Week nav */}
      <div className="flex items-center justify-between mb-8 pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <button className="btn-ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft size={14} /> Previous
        </button>
        <div className="text-center">
          <div className="display text-2xl" style={{ fontWeight: 400 }}>{formatWeekRange(weekStart)}</div>
          {isoDate(weekStart) !== isoDate(startOfWeek()) && (
            <button
              onClick={() => setWeekStart(startOfWeek())}
              className="label mt-1"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tomato)' }}
            >Jump to this week</button>
          )}
        </div>
        <button className="btn-ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          Next <ChevronRight size={14} />
        </button>
      </div>

      {recipes.length === 0 ? (
        <div className="text-center py-24 max-w-md mx-auto">
          <CalendarDays className="mx-auto mb-6" size={32} style={{ color: 'var(--ink-faint)' }} />
          <p className="display text-2xl mb-3 italic" style={{ color: 'var(--ink-soft)' }}>Add recipes first.</p>
          <p style={{ color: 'var(--ink-faint)' }}>You'll need a few recipes in your cookbook before you can plan a week.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {days.map(day => {
            const dayKey = isoDate(day);
            const dayPlan = mealPlan.days[dayKey] || {};
            const isToday = dayKey === today;
            const isPast = dayKey < today;

            return (
              <article
                key={dayKey}
                style={{
                  border: isToday ? '1px solid var(--tomato)' : '1px solid var(--line)',
                  background: isToday ? 'rgba(179, 74, 44, 0.04)' : 'var(--paper)',
                  padding: '20px 24px',
                  opacity: isPast ? 0.7 : 1
                }}
              >
                <div className="flex items-baseline justify-between mb-3">
                  <div className="flex items-baseline gap-3">
                    <span className="display text-xl" style={{ fontWeight: 400 }}>{dayLabel(day)}</span>
                    <span className="label">{day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    {isToday && <span className="label" style={{ color: 'var(--tomato)' }}>· today</span>}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {['breakfast', 'lunch', 'dinner'].map(meal => {
                    const slot = dayPlan[meal];
                    return (
                      <MealSlot
                        key={meal}
                        meal={meal}
                        slot={slot}
                        onPick={() => setPickerOpen({ date: day, meal })}
                        onClear={() => handleClearSlot(day, meal)}
                        onOpen={() => slot && onOpenRecipe(recipes.find(r => r.id === slot.recipeId))}
                        onMarkCooked={() => handleMarkCooked(dayKey, meal, slot)}
                        canMarkCooked={!isPast || dayKey === today}
                      />
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Recipe picker modal */}
      {pickerOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 12, 8, 0.6)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20, backdropFilter: 'blur(4px)'
          }}
          onClick={() => { setPickerOpen(null); setPickerSearch(''); }}
        >
          <div
            className="fadein"
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--paper)',
              maxWidth: 700, width: '100%', maxHeight: '80vh',
              display: 'flex', flexDirection: 'column',
              border: '1px solid var(--line)'
            }}
          >
            <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--line)' }}>
              <div className="flex items-baseline justify-between mb-1">
                <p className="label">Pick a recipe for</p>
                <button onClick={() => { setPickerOpen(null); setPickerSearch(''); }} className="btn-ghost" style={{ padding: 4 }}>
                  <X size={16} />
                </button>
              </div>
              <p className="display text-xl" style={{ fontWeight: 400 }}>
                {dayLabel(pickerOpen.date)} · {pickerOpen.meal}
              </p>
              <div className="flex items-center gap-2 mt-4">
                <Search size={14} style={{ color: 'var(--ink-faint)' }} />
                <input
                  className="input"
                  placeholder="Filter recipes…"
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
              {filteredPickerRecipes.length === 0 ? (
                <p className="text-center py-12 text-sm" style={{ color: 'var(--ink-faint)' }}>No recipes match.</p>
              ) : (
                filteredPickerRecipes.map(r => (
                  <button
                    key={r.id}
                    onClick={() => handleAssign(pickerOpen.date, pickerOpen.meal, r)}
                    className="w-full text-left flex items-center gap-3 p-3"
                    style={{
                      background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)',
                      cursor: 'pointer', transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--paper-deep)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {r.hero_image ? (
                      <img
                        src={r.hero_image}
                        alt=""
                        style={{ width: 56, height: 56, objectFit: 'cover', flexShrink: 0 }}
                        onError={e => e.currentTarget.style.display = 'none'}
                      />
                    ) : (
                      <div style={{ width: 56, height: 56, background: 'var(--paper-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <ChefHat size={20} style={{ color: 'var(--ink-faint)' }} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="display text-base truncate" style={{ fontWeight: 400 }}>{r.title}</div>
                      <div className="text-xs flex items-center gap-3 mt-0.5" style={{ color: 'var(--ink-faint)' }}>
                        {r.servings && <span>{r.servings}</span>}
                        {r.cook_time && <span>{r.cook_time}</span>}
                        {(r.diet_tags || []).slice(0, 2).map(t => <span key={t}>· {t}</span>)}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cook log prompt */}
      {logPrompt && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 12, 8, 0.6)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20, backdropFilter: 'blur(4px)'
          }}
          onClick={() => setLogPrompt(null)}
        >
          <CookedPrompt
            slot={logPrompt.slot}
            date={logPrompt.date}
            onCancel={() => setLogPrompt(null)}
            onConfirm={handleConfirmCooked}
          />
        </div>
      )}
    </div>
  );
}

function MealSlot({ meal, slot, onPick, onClear, onOpen, onMarkCooked, canMarkCooked }) {
  const mealLabel = meal.charAt(0).toUpperCase() + meal.slice(1);
  if (!slot) {
    return (
      <button
        onClick={onPick}
        className="text-left p-3 group"
        style={{
          background: 'transparent', border: '1px dashed var(--line)',
          cursor: 'pointer', transition: 'all 0.2s', minHeight: 80,
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between'
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--ink-soft)'; e.currentTarget.style.background = 'var(--paper-deep)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.background = 'transparent'; }}
      >
        <span className="label">{mealLabel}</span>
        <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--ink-faint)' }}>
          <Plus size={12} /> Add
        </span>
      </button>
    );
  }
  return (
    <div
      className="group relative"
      style={{
        background: slot.cooked ? 'var(--paper-deep)' : 'var(--paper)',
        border: '1px solid var(--line)',
        padding: '12px',
        minHeight: 80,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <div className="flex items-center justify-between">
        <span className="label" style={{ color: slot.cooked ? 'var(--ink-faint)' : 'var(--ink-soft)' }}>
          {mealLabel} {slot.cooked && '· ✓'}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!slot.cooked && canMarkCooked && (
            <button onClick={onMarkCooked} className="btn-ghost" style={{ padding: '2px 6px', fontSize: 11 }} title="Mark as cooked">
              <Check size={11} />
            </button>
          )}
          <button onClick={onClear} className="btn-ghost" style={{ padding: '2px 6px', color: 'var(--ink-faint)' }} title="Clear">
            <X size={11} />
          </button>
        </div>
      </div>
      <button
        onClick={onOpen}
        className="text-left flex items-center gap-2"
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          flex: 1, minWidth: 0,
          textDecoration: slot.cooked ? 'line-through' : 'none',
          opacity: slot.cooked ? 0.6 : 1
        }}
      >
        {slot.hero_image && (
          <img
            src={slot.hero_image}
            alt=""
            style={{ width: 36, height: 36, objectFit: 'cover', flexShrink: 0 }}
            onError={e => e.currentTarget.style.display = 'none'}
          />
        )}
        <span className="text-sm truncate" style={{ flex: 1 }}>{slot.recipeTitle}</span>
      </button>
    </div>
  );
}

function CookedPrompt({ slot, date, onCancel, onConfirm }) {
  const [note, setNote] = useState('');
  return (
    <div
      onClick={e => e.stopPropagation()}
      className="fadein"
      style={{
        background: 'var(--paper)',
        maxWidth: 480, width: '100%',
        padding: 28,
        border: '1px solid var(--line)'
      }}
    >
      <p className="label mb-2">Did you cook it?</p>
      <h2 className="display text-2xl mb-2" style={{ fontWeight: 400 }}>{slot.recipeTitle}</h2>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-soft)' }}>
        Add a quick note to your cooking journal (optional).
      </p>
      <AutoGrowTextarea
        className="input"
        style={{ padding: '8px 0', lineHeight: 1.6 }}
        placeholder="Made it with less salt, kids loved it…"
        minRows={2}
        value={note}
        onChange={e => setNote(e.target.value)}
        autoFocus
      />
      <div className="flex items-center gap-3 mt-6">
        <button className="btn-primary" onClick={() => onConfirm(note)}>
          <Check size={14} /> Log it
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- Settings View ----------
function SettingsView({ plan, recipeCount, onChangeTier, onClose, onShowUpgrade, userSubs, onAddUserSub, onUpdateUserSub, onRemoveUserSub, prefs, onUpdatePrefs }) {
  const tier = plan?.tier || 'free';
  const limits = LIMITS[tier];
  const usage = plan?.usage || {};

  const usageRows = [
    { key: 'url_extract', label: 'URL extractions' },
    { key: 'photo_extract', label: 'Photo extractions' },
    { key: 'method_adapt', label: 'Method adaptations' },
    { key: 'substitutions', label: 'Substitutions' },
    { key: 'shopping_consolidate', label: 'Shopping list consolidations' }
  ];

  return (
    <div className="max-w-3xl mx-auto px-8 py-12 fadein">
      <button className="btn-ghost mb-8" onClick={onClose}>
        <ArrowLeft size={14} /> Back
      </button>

      <div className="label mb-3">Account</div>
      <h1 className="display text-5xl md:text-6xl font-light leading-none mb-2">Your plan</h1>

      {/* Current plan card */}
      <div className="mt-10 mb-12" style={{ border: '1px solid var(--line)', padding: 32, background: tier !== 'free' ? 'var(--paper-deep)' : 'var(--paper)' }}>
        <div className="flex items-baseline justify-between flex-wrap gap-4 mb-2">
          <div className="flex items-baseline gap-3">
            {tier !== 'free' && <Sparkles size={20} style={{ color: 'var(--tomato)' }} />}
            <h2 className="display text-3xl" style={{ fontWeight: 400 }}>
              {PLAN_DETAILS[tier].name}
            </h2>
          </div>
          {tier === 'free' && (
            <button className="btn-primary" onClick={onShowUpgrade}>
              <Sparkles size={14} /> Upgrade
            </button>
          )}
        </div>
        <p style={{ color: 'var(--ink-soft)' }}>
          {tier === 'free' ? (
            <>You're on the free tier. Up to {LIMITS.free.recipes_max} recipes, plus a few free AI extractions each month.</>
          ) : (
            <>Unlimited recipes and AI features. Member since {plan.started_at ? new Date(plan.started_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'today'}.</>
          )}
        </p>
        {tier !== 'free' && (
          <p className="mt-4 text-sm" style={{ color: 'var(--ink-faint)' }}>
            ${PLAN_DETAILS[tier].price}/month · Next charge in 28 days · <button onClick={() => alert('Stripe billing portal would open here')} style={{ background: 'none', border: 'none', color: 'var(--tomato)', cursor: 'pointer', padding: 0, textDecoration: 'underline', font: 'inherit' }}>Manage billing</button>
          </p>
        )}
      </div>

      {/* Dev tier switcher — moved to the top for easy access */}
      <section className="mb-12 p-5" style={{ background: 'rgba(179, 74, 44, 0.06)', border: '1px dashed var(--tomato)' }}>
        <div className="flex items-baseline gap-2 mb-2">
          <Sparkles size={12} style={{ color: 'var(--tomato)' }} />
          <span className="label" style={{ color: 'var(--tomato)' }}>Demo mode · instant tier switch</span>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--ink-soft)' }}>
          Switch tiers instantly to test gates, screenshot the upgrade flow, or demo the model. In production, this is replaced with Stripe Checkout.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {Object.keys(PLAN_DETAILS).map(t => {
            const isActive = tier === t;
            return (
              <button
                key={t}
                onClick={() => onChangeTier(t)}
                style={{
                  padding: '14px 8px',
                  minHeight: 48,
                  fontSize: 14,
                  fontWeight: 500,
                  border: `1px solid ${isActive ? 'var(--ink)' : 'var(--line)'}`,
                  background: isActive ? 'var(--ink)' : 'var(--paper)',
                  color: isActive ? 'var(--paper)' : 'var(--ink)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                  WebkitTapHighlightColor: 'rgba(179, 74, 44, 0.2)',
                  touchAction: 'manipulation',
                  textAlign: 'center'
                }}
              >
                {PLAN_DETAILS[t].name}
              </button>
            );
          })}
        </div>
      </section>

      {/* Usage this month */}
      <section className="mb-12">
        <h2 className="display text-2xl mb-1">This month</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--ink-faint)' }}>
          Resets on the 1st. {tier === 'free' ? 'Free includes limited AI usage.' : 'Plus and Family include unlimited AI.'}
        </p>

        {/* Recipe count */}
        <div className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-sm">Recipes saved</span>
            <span className="mono text-sm" style={{ color: 'var(--ink-soft)' }}>
              {recipeCount}{limits.recipes_max === Infinity ? '' : ` / ${limits.recipes_max}`}
            </span>
          </div>
          {limits.recipes_max !== Infinity && (
            <div style={{ height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, (recipeCount / limits.recipes_max) * 100)}%`,
                  background: recipeCount >= limits.recipes_max ? 'var(--tomato)' : 'var(--ink)',
                  transition: 'all 0.3s'
                }}
              />
            </div>
          )}
        </div>

        {usageRows.map(row => {
          const limit = limits[row.key];
          const used = usage[row.key] || 0;
          const isUnlimited = limit === Infinity;
          const pct = isUnlimited ? 0 : (limit > 0 ? Math.min(100, (used / limit) * 100) : 0);
          const atLimit = limit !== Infinity && used >= limit;
          return (
            <div key={row.key} className="mb-4 pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm">{row.label}</span>
                <span className="mono text-sm" style={{ color: atLimit ? 'var(--tomato)' : 'var(--ink-soft)' }}>
                  {isUnlimited ? '∞ unlimited' : `${used} / ${limit}`}
                </span>
              </div>
              {!isUnlimited && limit > 0 && (
                <div style={{ height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: atLimit ? 'var(--tomato)' : 'var(--ink)',
                      transition: 'all 0.3s'
                    }}
                  />
                </div>
              )}
              {!isUnlimited && limit === 0 && (
                <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                  Available on Plus and Family
                </p>
              )}
            </div>
          );
        })}
      </section>

      {/* Display preferences */}
      <section className="mb-12">
        <h2 className="display text-2xl mb-2">Display</h2>
        <p className="text-sm mb-6" style={{ color: 'var(--ink-soft)' }}>
          What you see when reading a recipe.
        </p>
        <div
          className="py-4 flex items-start justify-between gap-4"
          style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
        >
          <div style={{ flex: 1 }}>
            <p className="text-sm" style={{ fontWeight: 500, marginBottom: 4 }}>Show ingredient info</p>
            <p className="text-xs" style={{ color: 'var(--ink-faint)', lineHeight: 1.5 }}>
              Adds a small <em>info</em> tag to each ingredient. Tap to see history, storage, cooking notes, and what it pairs with. Curated for common ingredients, AI-generated for the rest.
            </p>
          </div>
          <button
            onClick={() => onUpdatePrefs({ showIngredientInfo: !prefs?.showIngredientInfo })}
            style={{
              flexShrink: 0,
              width: 44,
              height: 24,
              borderRadius: 100,
              border: 'none',
              cursor: 'pointer',
              background: prefs?.showIngredientInfo ? 'var(--tomato)' : 'var(--line)',
              padding: 0,
              position: 'relative',
              transition: 'background 0.2s'
            }}
            title={prefs?.showIngredientInfo ? 'On' : 'Off'}
            aria-pressed={!!prefs?.showIngredientInfo}
          >
            <span
              style={{
                position: 'absolute',
                top: 2,
                left: prefs?.showIngredientInfo ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
              }}
            />
          </button>
        </div>
      </section>

      {/* My substitutions */}
      <UserSubsSection
        userSubs={userSubs}
        onAdd={onAddUserSub}
        onUpdate={onUpdateUserSub}
        onRemove={onRemoveUserSub}
      />

      {/* Plan comparison */}
      <section className="mb-12">
        <h2 className="display text-2xl mb-6">All plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(PLAN_DETAILS).map(([key, details]) => {
            const isCurrent = tier === key;
            return (
              <div
                key={key}
                style={{
                  border: isCurrent ? '2px solid var(--tomato)' : '1px solid var(--line)',
                  padding: 24,
                  background: 'var(--paper)',
                  position: 'relative'
                }}
              >
                {isCurrent && (
                  <span className="label" style={{ position: 'absolute', top: -10, left: 16, background: 'var(--tomato)', color: 'var(--paper)', padding: '2px 10px', letterSpacing: '0.1em' }}>
                    CURRENT
                  </span>
                )}
                <h3 className="display text-2xl mb-1" style={{ fontWeight: 400 }}>{details.name}</h3>
                <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>{details.tagline}</p>
                <div className="display text-3xl mb-1" style={{ fontWeight: 300 }}>
                  ${details.price}<span className="text-base" style={{ color: 'var(--ink-faint)' }}>{details.pricePeriod}</span>
                </div>
                {details.yearly && (
                  <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>or ${details.yearly}/year</p>
                )}
                {!details.yearly && <p className="text-xs mb-4" style={{ color: 'var(--ink-faint)' }}>forever</p>}
                <ul className="space-y-2 text-sm" style={{ color: 'var(--ink-soft)' }}>
                  {key === 'free' && (
                    <>
                      <li>· Up to 25 recipes</li>
                      <li>· 3 AI extractions/month</li>
                      <li>· Cook mode + journal</li>
                      <li>· Manual shopping list</li>
                      <li>· Image export (with watermark)</li>
                    </>
                  )}
                  {key === 'plus' && (
                    <>
                      <li>· Unlimited recipes</li>
                      <li>· Unlimited AI extractions</li>
                      <li>· Method adapt + substitutions</li>
                      <li>· AI shopping consolidation</li>
                      <li>· Meal planner integrations</li>
                      <li>· No-watermark image export</li>
                    </>
                  )}
                  {key === 'family' && (
                    <>
                      <li>· Everything in Plus</li>
                      <li>· Up to 5 household members</li>
                      <li>· Shared shopping list</li>
                      <li>· Shared meal plan</li>
                      <li>· Shared cook journal</li>
                    </>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------- Upgrade Modal ----------
function UpgradeModal({ feature, check, currentTier, onClose, onUpgrade }) {
  const featureLabel = feature ? FEATURE_LABELS[feature] : null;
  const isUsageLimit = check?.reason === 'usage';
  const isPlanLock = check?.reason === 'plan';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 12, 8, 0.7)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, backdropFilter: 'blur(6px)'
      }}
      onClick={onClose}
    >
      <div
        className="fadein"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto',
          border: '1px solid var(--line)',
          position: 'relative'
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 8, color: 'var(--ink-faint)', zIndex: 1
          }}
        >
          <X size={18} />
        </button>

        <div style={{ padding: '40px 40px 32px' }}>
          {feature ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={14} style={{ color: 'var(--tomato)' }} />
                <span className="label" style={{ color: 'var(--tomato)' }}>
                  {isUsageLimit ? 'Free limit reached' : 'Plus feature'}
                </span>
              </div>
              <h2 className="display text-4xl font-light leading-tight mb-3">
                {isUsageLimit ? <>You're out of free <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>{featureLabel?.toLowerCase()}</em> this month.</> : <>Unlock <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>{featureLabel?.toLowerCase()}</em></>}
              </h2>
              <p className="text-base mb-2" style={{ color: 'var(--ink-soft)' }}>
                {isUsageLimit
                  ? `You've used all ${check.limit} free ${featureLabel?.toLowerCase()} this month. Resets on the 1st.`
                  : `Available on Plus and Family. The AI does the heavy lifting so you don't have to.`}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={14} style={{ color: 'var(--tomato)' }} />
                <span className="label" style={{ color: 'var(--tomato)' }}>Upgrade</span>
              </div>
              <h2 className="display text-4xl font-light leading-tight mb-3">
                Cook smarter with <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>Plus</em>
              </h2>
              <p className="text-base" style={{ color: 'var(--ink-soft)' }}>
                Unlock unlimited recipes, AI extraction, smart shopping lists, and more.
              </p>
            </>
          )}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '28px 40px' }}>
          <p className="label mb-4">What you get with Plus</p>
          <ul className="space-y-3">
            {[
              ['Unlimited recipes', 'No more 25-recipe cap.'],
              ['Unlimited AI extractions', 'URL, photo, method adapt, substitutions — all without quota.'],
              ['Smart shopping lists', 'AI-consolidated, grouped by aisle, deduped across recipes.'],
              ['Meal planner integration', 'Send a week of meals to your shopping list in one click.'],
              ['Clean image exports', 'No watermark on shared recipe cards.']
            ].map(([title, desc]) => (
              <li key={title} className="flex items-start gap-3">
                <Check size={16} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 3 }} />
                <div>
                  <div className="text-sm" style={{ fontWeight: 500 }}>{title}</div>
                  <div className="text-sm" style={{ color: 'var(--ink-soft)' }}>{desc}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '28px 40px', background: 'var(--paper-deep)' }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => onUpgrade('plus')}
              className="btn-primary"
              style={{ padding: '16px 24px', justifyContent: 'space-between', fontSize: 15 }}
            >
              <span className="flex items-center gap-2"><Sparkles size={14} /> Plus</span>
              <span><strong>$4.99</strong>/mo or $39/yr</span>
            </button>
            <button
              onClick={() => onUpgrade('family')}
              className="btn-primary"
              style={{ padding: '16px 24px', justifyContent: 'space-between', fontSize: 15, background: 'var(--tomato)' }}
            >
              <span className="flex items-center gap-2"><Users size={14} /> Family</span>
              <span><strong>$7.99</strong>/mo or $59/yr</span>
            </button>
          </div>
          <p className="text-xs mt-4 text-center" style={{ color: 'var(--ink-faint)' }}>
            Cancel anytime · 14-day free trial · No card required for trial
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- RecipeStats ----------
// Compact stats panel summarizing a recipe's cook history.
function RecipeStats({ cookLog, createdAt }) {
  const stats = useMemo(() => {
    const total = cookLog.length;
    const ups = cookLog.filter(e => e.rating === 'up').length;
    const downs = cookLog.filter(e => e.rating === 'down').length;
    const rated = ups + downs;
    const positivity = rated > 0 ? Math.round((ups / rated) * 100) : null;
    const lastCooked = cookLog[0]?.date || null;
    const photos = cookLog.filter(e => e.photo).length;

    let lastCookedLabel = '';
    if (lastCooked) {
      const days = Math.floor((Date.now() - lastCooked) / (24 * 60 * 60 * 1000));
      if (days === 0) lastCookedLabel = 'today';
      else if (days === 1) lastCookedLabel = 'yesterday';
      else if (days < 7) lastCookedLabel = `${days} days ago`;
      else if (days < 30) lastCookedLabel = `${Math.floor(days / 7)} ${Math.floor(days / 7) === 1 ? 'week' : 'weeks'} ago`;
      else if (days < 365) lastCookedLabel = `${Math.floor(days / 30)} ${Math.floor(days / 30) === 1 ? 'month' : 'months'} ago`;
      else lastCookedLabel = `${Math.floor(days / 365)} ${Math.floor(days / 365) === 1 ? 'year' : 'years'} ago`;
    }

    return { total, ups, downs, rated, positivity, lastCookedLabel, photos };
  }, [cookLog]);

  if (stats.total === 0) return null;

  return (
    <div className="mb-8 p-5" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
      <div className="flex items-baseline gap-2 mb-4">
        <Activity size={12} style={{ color: 'var(--ink-faint)' }} />
        <span className="label">Track record</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="display text-3xl" style={{ fontWeight: 300, color: 'var(--ink)' }}>{stats.total}×</div>
          <div className="label">Cooked</div>
        </div>
        {stats.lastCookedLabel && (
          <div>
            <div className="display text-base" style={{ fontWeight: 400, color: 'var(--ink-soft)', marginTop: 8 }}>{stats.lastCookedLabel}</div>
            <div className="label">Last made</div>
          </div>
        )}
        {stats.positivity !== null ? (
          <div>
            <div className="display text-3xl flex items-baseline gap-1" style={{ fontWeight: 300, color: stats.positivity >= 60 ? 'var(--olive)' : (stats.positivity < 40 ? 'var(--tomato)' : 'var(--ink)') }}>
              {stats.positivity}<span className="text-sm" style={{ color: 'var(--ink-faint)' }}>%</span>
            </div>
            <div className="label">{stats.ups}👍 {stats.downs}👎</div>
          </div>
        ) : (
          <div>
            <div className="text-sm" style={{ color: 'var(--ink-faint)', marginTop: 12 }}>Not rated yet</div>
            <div className="label">Verdict</div>
          </div>
        )}
        <div>
          <div className="display text-3xl" style={{ fontWeight: 300, color: 'var(--ink)' }}>{stats.photos}</div>
          <div className="label">Photos</div>
        </div>
      </div>
    </div>
  );
}

// ---------- Onboarding ----------
function OnboardingModal({ onDismiss, onAddRecipe }) {
  const [step, setStep] = useState(0);

  const slides = [
    {
      eyebrow: 'Welcome to',
      title: 'salt & page.',
      titleAccent: '.',
      body: 'Save every recipe you love in one place. Cook from it. Plan around it. Build a real cookbook.',
      icon: <BookOpen size={36} style={{ color: 'var(--tomato)' }} />,
      cta: 'Continue'
    },
    {
      eyebrow: 'Three ways',
      title: 'Add a recipe',
      body: null,
      icon: null,
      cta: 'Continue',
      content: (
        <div className="space-y-4 mt-6">
          <div className="flex items-start gap-4 p-4" style={{ background: 'var(--paper-deep)' }}>
            <LinkIcon size={20} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div className="text-base mb-1" style={{ fontWeight: 500 }}>Paste a URL</div>
              <div className="text-sm" style={{ color: 'var(--ink-soft)' }}>From any food blog. We skip the life story and pull just the recipe.</div>
            </div>
          </div>
          <div className="flex items-start gap-4 p-4" style={{ background: 'var(--paper-deep)' }}>
            <Camera size={20} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div className="text-base mb-1" style={{ fontWeight: 500 }}>Take a photo</div>
              <div className="text-sm" style={{ color: 'var(--ink-soft)' }}>Cookbook page, recipe card, handwritten note. We read it for you.</div>
            </div>
          </div>
          <div className="flex items-start gap-4 p-4" style={{ background: 'var(--paper-deep)' }}>
            <Edit3 size={20} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div className="text-base mb-1" style={{ fontWeight: 500 }}>Type it by hand</div>
              <div className="text-sm" style={{ color: 'var(--ink-soft)' }}>For Grandma's recipes, or anything not online.</div>
            </div>
          </div>
        </div>
      )
    },
    {
      eyebrow: 'When you cook',
      title: 'Use cook mode',
      body: 'Big readable type. Auto-timers from the recipe text. Screen stays awake. Optional voice control — say "next step" hands-free.',
      icon: <Flame size={36} style={{ color: 'var(--tomato)' }} />,
      cta: 'Add my first recipe',
      isLast: true
    }
  ];

  const slide = slides[step];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 12, 8, 0.7)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, backdropFilter: 'blur(6px)'
      }}
    >
      <div
        className="fadein"
        style={{
          background: 'var(--paper)',
          maxWidth: 540, width: '100%',
          border: '1px solid var(--line)',
          padding: '40px 40px 32px',
          position: 'relative'
        }}
      >
        <button
          onClick={onDismiss}
          aria-label="Skip tour"
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 8, color: 'var(--ink-faint)', fontSize: 11,
            letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'inherit'
          }}
        >
          Skip tour
        </button>

        {slide.icon && <div className="mb-6">{slide.icon}</div>}

        <div className="label mb-2">{slide.eyebrow}</div>
        <h2 className="display text-5xl font-light leading-none mb-4">
          {slide.title === 'salt & page.' ? (
            <>salt <span style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>&amp;</span> page<span style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>.</span></>
          ) : slide.title}
        </h2>
        {slide.body && (
          <p className="text-base mb-2" style={{ color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            {slide.body}
          </p>
        )}
        {slide.content}

        {/* Progress dots */}
        <div className="flex items-center gap-2 mt-8 mb-6">
          {slides.map((_, i) => (
            <span
              key={i}
              style={{
                width: i === step ? 20 : 6, height: 6, borderRadius: 100,
                background: i === step ? 'var(--tomato)' : 'var(--line)',
                transition: 'all 0.3s'
              }}
            />
          ))}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            className="btn-primary"
            onClick={() => slide.isLast ? onAddRecipe() : setStep(step + 1)}
          >
            {slide.cta} {!slide.isLast && <ChevronRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- EstimateReviewModal ----------
// Shows AI-proposed step time estimates side-by-side with each step.
// User can edit each, accept/reject, then apply all at once.
function EstimateReviewModal({ review, onChange, onApply, onCancel }) {
  const updateItem = (idx, value) => {
    const next = review.items.map((it, i) => i === idx ? { ...it, accepted: value } : it);
    onChange(next);
  };

  const acceptedCount = review.items.filter(it => it.accepted).length;
  const totalActive = review.items.reduce((sum, it) => sum + (it.accepted || 0), 0);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 12, 8, 0.7)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, backdropFilter: 'blur(6px)'
      }}
      onClick={onCancel}
    >
      <div
        className="fadein"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto',
          border: '1px solid var(--line)',
          position: 'relative'
        }}
      >
        <div style={{ padding: '32px 32px 20px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--paper)', zIndex: 1 }}>
          <button
            onClick={onCancel}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 8, color: 'var(--ink-faint)'
            }}
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} style={{ color: 'var(--tomato)' }} />
            <span className="label" style={{ color: 'var(--tomato)' }}>AI estimates</span>
          </div>
          <h2 className="display text-3xl font-light leading-tight mb-2">
            Review proposed step times
          </h2>
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            Edit any number you disagree with, or clear it to drop the estimate. Trivial steps (serving, garnishing) are intentionally left blank.
          </p>
        </div>

        <div style={{ padding: '20px 32px' }}>
          {review.items.map((item, i) => (
            <div key={i} className="py-4" style={{ borderBottom: i < review.items.length - 1 ? '1px solid var(--line)' : 'none' }}>
              <div className="flex items-start gap-4">
                <span className="display text-2xl mt-0" style={{ color: 'var(--tomato)', minWidth: 28, fontWeight: 300, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm mb-3" style={{ lineHeight: 1.6, color: 'var(--ink)' }}>
                    {item.text}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    {item.existing && (
                      <span className="label" style={{ color: 'var(--ink-faint)' }}>
                        was: {formatStepDuration(item.existing)}
                      </span>
                    )}
                    <input
                      type="number"
                      min="0"
                      max="600"
                      placeholder="—"
                      value={item.accepted ?? ''}
                      onChange={e => {
                        const n = parseInt(e.target.value, 10);
                        updateItem(i, isNaN(n) ? null : n);
                      }}
                      style={{
                        width: 70,
                        padding: '6px 8px',
                        background: 'var(--paper-deep)',
                        border: '1px solid var(--line)',
                        fontSize: 14,
                        fontFamily: 'inherit',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: item.accepted ? 'var(--ink)' : 'var(--ink-faint)'
                      }}
                    />
                    <span className="label" style={{ color: 'var(--ink-faint)' }}>min</span>
                    {item.proposed && item.accepted !== item.proposed && (
                      <button
                        onClick={() => updateItem(i, item.proposed)}
                        className="text-xs"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tomato)', textDecoration: 'underline', fontFamily: 'inherit', padding: 0 }}
                      >
                        Restore AI estimate ({item.proposed})
                      </button>
                    )}
                    {item.accepted && (
                      <button
                        onClick={() => updateItem(i, null)}
                        className="text-xs"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontFamily: 'inherit', padding: 0 }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--line)', padding: '16px 32px', background: 'var(--paper-deep)', position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            {acceptedCount} {acceptedCount === 1 ? 'step' : 'steps'} timed · total ~{formatStepDuration(totalActive)}
          </p>
          <div className="flex items-center gap-3">
            <button className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn-primary" onClick={onApply}>
              <Check size={14} /> Apply to recipe
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- DuplicateWarning ----------
// Surfaces inline at the top of the recipe-review form when an import looks
// like an exact duplicate or close match to a recipe already in the cookbook.
function DuplicateWarning({ exact, similar, onViewRecipe, onDismiss }) {
  if (!exact && (!similar || similar.length === 0)) return null;

  if (exact) {
    return (
      <div className="mb-6 p-5 fadein" style={{ background: 'rgba(179, 74, 44, 0.08)', border: '1px solid var(--tomato)' }}>
        <div className="flex items-start gap-3">
          <AlertCircle size={18} style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }} />
          <div className="flex-1 min-w-0">
            <p className="text-base mb-1" style={{ fontWeight: 500, color: 'var(--tomato-deep)' }}>
              You already have this recipe
            </p>
            <p className="text-sm mb-3" style={{ color: 'var(--ink-soft)' }}>
              {exact.reason === 'url'
                ? 'This URL matches a recipe in your cookbook.'
                : 'A recipe with the same name is already saved.'}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button className="btn-primary" onClick={() => onViewRecipe(exact.recipe.id)} style={{ padding: '8px 16px', fontSize: 13 }}>
                <BookOpen size={13} /> View saved version
              </button>
              <button className="btn-ghost" onClick={onDismiss} style={{ fontSize: 12 }}>
                Save this one anyway
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Similar recipes
  return (
    <div className="mb-6 p-5 fadein" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
      <div className="flex items-start gap-3">
        <Sparkles size={16} style={{ color: 'var(--ink-soft)', flexShrink: 0, marginTop: 2 }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm mb-2" style={{ fontWeight: 500 }}>
            Similar to {similar.length === 1 ? 'a recipe' : 'recipes'} you've already saved:
          </p>
          <div className="flex flex-col gap-2 mb-3">
            {similar.map(s => (
              <button
                key={s.recipe.id}
                onClick={() => onViewRecipe(s.recipe.id)}
                className="flex items-center gap-3 p-2"
                style={{
                  background: 'var(--paper)',
                  border: '1px solid var(--line)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  transition: 'border-color 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--ink)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}
              >
                {s.recipe.hero_image ? (
                  <img src={s.recipe.hero_image} alt="" style={{ width: 36, height: 36, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 36, height: 36, background: 'var(--paper-deep)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ChefHat size={14} style={{ color: 'var(--ink-faint)' }} />
                  </div>
                )}
                <span className="text-sm flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>{s.recipe.title}</span>
                <ChevronRight size={14} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
              </button>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
            You can still save this one — useful if it's a different version.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- SendToFriendModal ----------
// Generates a kitchen-share code and offers two delivery paths:
// 1) Copy the code (paste-anywhere, friend uses Add → Paste shared code)
// 2) Native share sheet (uses navigator.share if available — opens iOS/Android/macOS share menu)
function SendToFriendModal({ recipe, onClose }) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const code = useMemo(() => encodeRecipeForShare(recipe), [recipe]);
  const codeSize = code.length;
  const codeKb = (codeSize / 1024).toFixed(1);

  const friendlyMessage = `Hey — I just saved "${recipe.title}" in my Salt & Page cookbook and thought you'd like it. Paste this code into your cookbook at Add → Paste shared code:\n\n${code}\n\nIf you don't have Salt & Page yet, ask me and I'll help you get set up.`;

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyMessage = async () => {
    await navigator.clipboard.writeText(friendlyMessage);
    setCopied('message');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleNativeShare = async () => {
    if (!navigator.share) {
      alert('Native sharing not supported in this browser. Use Copy code instead.');
      return;
    }
    setSharing(true);
    try {
      await navigator.share({
        title: recipe.title,
        text: friendlyMessage
      });
    } catch (e) {
      // User canceled — silent
    } finally {
      setSharing(false);
    }
  };

  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 12, 8, 0.7)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, backdropFilter: 'blur(6px)'
      }}
      onClick={onClose}
    >
      <div
        className="fadein"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto',
          border: '1px solid var(--line)',
          position: 'relative'
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 8, color: 'var(--ink-faint)', zIndex: 1
          }}
        >
          <X size={18} />
        </button>

        <div style={{ padding: '36px 32px 24px' }}>
          <div className="flex items-center gap-2 mb-2">
            <Send size={14} style={{ color: 'var(--tomato)' }} />
            <span className="label" style={{ color: 'var(--tomato)' }}>Send to a friend</span>
          </div>
          <h2 className="display text-3xl font-light leading-tight mb-2">
            Share <em style={{ color: 'var(--tomato)', fontStyle: 'italic' }}>{recipe.title}</em>
          </h2>
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            Two ways to share. The code is the fastest path — friend pastes it in their cookbook, recipe imported instantly.
          </p>
        </div>

        {/* Native share (mobile-first, desktop where supported) */}
        {canNativeShare && (
          <div style={{ borderTop: '1px solid var(--line)', padding: '20px 32px' }}>
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
              <p className="label">Option 1 · Send via your device</p>
              <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>Messages, Mail, AirDrop, anything</span>
            </div>
            <button
              className="btn-primary w-full"
              onClick={handleNativeShare}
              disabled={sharing}
              style={{ justifyContent: 'center', padding: '14px' }}
            >
              {sharing ? <Loader2 size={14} className="spinning" /> : <Smartphone size={14} />}
              Open share menu
            </button>
            <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
              Sends a message containing the import code. Recipient pastes it in their cookbook.
            </p>
          </div>
        )}

        {/* Copy code option */}
        <div style={{ borderTop: '1px solid var(--line)', padding: '20px 32px' }}>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <p className="label">Option {canNativeShare ? '2' : '1'} · Copy the code</p>
            <span className="text-xs" style={{ color: 'var(--ink-faint)' }}>{codeKb} KB</span>
          </div>
          <div
            className="mono"
            style={{
              background: 'var(--paper-deep)',
              border: '1px solid var(--line)',
              padding: '12px',
              fontSize: 11,
              lineHeight: 1.5,
              maxHeight: 100,
              overflow: 'auto',
              wordBreak: 'break-all',
              color: 'var(--ink-soft)',
              marginBottom: 12
            }}
          >
            {code.length > 200 ? code.slice(0, 200) + '…' : code}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" onClick={handleCopyCode}>
              {copied === true ? <><Check size={14} /> Code copied</> : <><Copy size={14} /> Copy code only</>}
            </button>
            <button className="btn-ghost" onClick={handleCopyMessage}>
              {copied === 'message' ? <><Check size={14} /> Message copied</> : <><Copy size={14} /> Copy message + code</>}
            </button>
          </div>
        </div>

        {/* How recipient uses it */}
        <div style={{ borderTop: '1px solid var(--line)', padding: '20px 32px', background: 'var(--paper-deep)' }}>
          <p className="label mb-3">How your friend imports it</p>
          <ol className="text-sm space-y-2" style={{ color: 'var(--ink-soft)', lineHeight: 1.6, paddingLeft: 20 }}>
            <li>They open Salt &amp; Page (their own copy)</li>
            <li>Click <strong>Add new recipe</strong></li>
            <li>Choose <strong>Paste shared code</strong></li>
            <li>Paste what you sent — the recipe appears in their cookbook</li>
          </ol>
          <p className="text-xs mt-4" style={{ color: 'var(--ink-faint)' }}>
            {recipe.hero_image && recipe.hero_image.startsWith('data:') ? (
              <>Note: your hero photo isn't included in the code (would make it too large to paste). All ingredients, steps, notes, and times are included.</>
            ) : (
              <>The recipe code includes everything except your private cook log. They get a clean copy.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------- UserSubsSection ----------
// Manages the user's saved personal substitutions in Settings. Add, edit, delete.
// Saved subs always take priority over the curated library and AI suggestions.
function UserSubsSection({ userSubs, onAdd, onUpdate, onRemove }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ ingredient: '', swap: '', ratio: '', notes: '' });

  const items = userSubs?.items || [];

  const startAdd = () => {
    setEditingId(null);
    setDraft({ ingredient: '', swap: '', ratio: '', notes: '' });
    setAdding(true);
  };
  const startEdit = (item) => {
    setAdding(false);
    setEditingId(item.id);
    setDraft({
      ingredient: item.ingredient || '',
      swap: item.swap || '',
      ratio: item.ratio || '',
      notes: item.notes || ''
    });
  };
  const cancelEdit = () => {
    setAdding(false);
    setEditingId(null);
    setDraft({ ingredient: '', swap: '', ratio: '', notes: '' });
  };
  const handleSave = async () => {
    if (!draft.ingredient.trim() || !draft.swap.trim()) return;
    if (editingId) {
      await onUpdate(editingId, {
        ingredient: draft.ingredient.trim(),
        swap: draft.swap.trim(),
        ratio: draft.ratio.trim(),
        notes: draft.notes.trim()
      });
    } else {
      await onAdd(draft);
    }
    cancelEdit();
  };

  // Group by ingredient for display
  const grouped = useMemo(() => {
    const map = new Map();
    items.forEach(item => {
      const key = (item.ingredient || '').toLowerCase().trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  return (
    <section className="mb-12">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h2 className="display text-2xl">My substitutions</h2>
        {!adding && !editingId && (
          <button className="btn-ghost" onClick={startAdd}>
            <Plus size={12} /> Add a swap
          </button>
        )}
      </div>
      <p className="text-sm mb-6" style={{ color: 'var(--ink-soft)' }}>
        Your personal swap rules. When you click <em>sub</em> on a matching ingredient in any recipe, your saved swaps appear first — instant, no AI lookup.
      </p>

      {(adding || editingId) && (
        <div className="mb-6 p-5 fadein" style={{ background: 'var(--paper-deep)', border: '1px solid var(--line)' }}>
          <p className="label mb-3" style={{ color: 'var(--tomato)' }}>{editingId ? 'Edit swap' : 'New swap'}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="label block mb-1" style={{ fontSize: 10 }}>Original ingredient</label>
              <input
                className="input"
                style={{ fontSize: 14, padding: '6px 0' }}
                placeholder="e.g., buttermilk"
                value={draft.ingredient}
                onChange={e => setDraft(d => ({ ...d, ingredient: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <label className="label block mb-1" style={{ fontSize: 10 }}>What you swap with</label>
              <input
                className="input"
                style={{ fontSize: 14, padding: '6px 0' }}
                placeholder="e.g., homemade kefir"
                value={draft.swap}
                onChange={e => setDraft(d => ({ ...d, swap: e.target.value }))}
              />
            </div>
            <div>
              <label className="label block mb-1" style={{ fontSize: 10 }}>Ratio (optional)</label>
              <input
                className="input"
                style={{ fontSize: 14, padding: '6px 0' }}
                placeholder="e.g., 1:1"
                value={draft.ratio}
                onChange={e => setDraft(d => ({ ...d, ratio: e.target.value }))}
              />
            </div>
            <div>
              <label className="label block mb-1" style={{ fontSize: 10 }}>Notes (optional)</label>
              <input
                className="input"
                style={{ fontSize: 14, padding: '6px 0' }}
                placeholder="e.g., Use the thicker brand"
                value={draft.notes}
                onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={!draft.ingredient.trim() || !draft.swap.trim()}
            >
              <Check size={14} /> {editingId ? 'Save changes' : 'Save swap'}
            </button>
            <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      )}

      {items.length === 0 && !adding ? (
        <div className="py-10 text-center" style={{ background: 'var(--paper-deep)', border: '1px dashed var(--line)' }}>
          <Replace size={20} style={{ color: 'var(--ink-faint)', margin: '0 auto 12px' }} />
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>No saved swaps yet.</p>
          <p className="text-xs mt-2" style={{ color: 'var(--ink-faint)' }}>
            Tap <em>sub</em> on any ingredient in a recipe and choose "Save your own swap" — or add one here.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {grouped.map(([ingredient, group]) => (
            <div key={ingredient} className="py-3" style={{ borderBottom: '1px solid var(--line)' }}>
              <p className="label mb-2" style={{ color: 'var(--tomato)', textTransform: 'lowercase' }}>{ingredient}</p>
              <div className="space-y-2">
                {group.map(item => (
                  <div key={item.id} className="flex items-start gap-3 group/item">
                    <span style={{ color: 'var(--tomato)', flexShrink: 0, marginTop: 2 }}>·</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <strong className="text-sm" style={{ fontWeight: 600 }}>{item.swap}</strong>
                        {item.ratio && <span className="mono text-xs" style={{ color: 'var(--ink-faint)' }}>{item.ratio}</span>}
                      </div>
                      {item.notes && <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>{item.notes}</p>}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(item)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}
                        title="Edit"
                      >
                        <Edit3 size={12} />
                      </button>
                      <button
                        onClick={() => onRemove(item.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 4 }}
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- IngredientInfoModal ----------
// Editorial-style popup for ingredient info: about, storage, cooking notes,
// pairings, and a Wikipedia link. Receives state from DetailView (which
// handles the library check + AI fallback).
function IngredientInfoModal({ ingredient, state, onClose }) {
  // ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Strip leading quantities/units from the ingredient text for the title
  // ("1 1/2 cups buttermilk, room temp" → "buttermilk, room temp")
  const titleText = (() => {
    if (!ingredient) return '';
    const cleaned = ingredient.trim()
      .replace(/^\d+([\/\.\s]\d+)?\s*/, '') // leading number/fraction
      .replace(/^(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|liters?|l)\s+/i, '')
      .replace(/^of\s+/i, '');
    return cleaned || ingredient;
  })();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26, 22, 18, 0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'fadein 0.2s ease-out'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fadein"
        style={{
          background: 'var(--paper)',
          maxWidth: 520,
          width: '100%',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '40px 32px 32px',
          position: 'relative',
          boxShadow: '0 30px 80px -20px rgba(0,0,0,0.4)'
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--ink-faint)',
            padding: 6,
            borderRadius: 100
          }}
          title="Close"
        >
          <X size={18} />
        </button>

        <p className="label" style={{ color: 'var(--tomato)', marginBottom: 8 }}>About this ingredient</p>
        <h2
          className="display"
          style={{ fontSize: 36, fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.01em', margin: '0 0 24px 0', textTransform: 'lowercase' }}
        >
          {titleText}
        </h2>

        {state?.loading && (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-faint)' }}>
            <Loader2 size={20} className="spinning" style={{ margin: '0 auto 12px', display: 'block' }} />
            <p className="text-sm">Looking it up…</p>
          </div>
        )}

        {state?.error && (
          <div className="text-sm" style={{ color: 'var(--tomato)', padding: '12px 0' }}>
            {state.error}
          </div>
        )}

        {state?.results && (
          <div>
            {state.results.about && (
              <section style={{ marginBottom: 24 }}>
                <p className="label" style={{ marginBottom: 8 }}>About</p>
                <p className="text-sm" style={{ lineHeight: 1.6, color: 'var(--ink-soft)' }}>
                  {state.results.about}
                </p>
              </section>
            )}

            {state.results.storage && (
              <section style={{ marginBottom: 24, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <p className="label" style={{ marginBottom: 8 }}>Keep it fresh</p>
                <p className="text-sm" style={{ lineHeight: 1.6, color: 'var(--ink-soft)' }}>
                  {state.results.storage}
                </p>
              </section>
            )}

            {state.results.cooking && (
              <section style={{ marginBottom: 24, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <p className="label" style={{ marginBottom: 8 }}>Cooking notes</p>
                <p className="text-sm" style={{ lineHeight: 1.6, color: 'var(--ink-soft)' }}>
                  {state.results.cooking}
                </p>
              </section>
            )}

            {Array.isArray(state.results.pairs) && state.results.pairs.length > 0 && (
              <section style={{ marginBottom: 24, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
                <p className="label" style={{ marginBottom: 12 }}>Pairs with</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {state.results.pairs.map((p, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: 12,
                        padding: '4px 10px',
                        background: 'var(--paper-deep)',
                        color: 'var(--ink-soft)',
                        borderRadius: 100
                      }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {state.results.wikipedia && (
              <div style={{ paddingTop: 20, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <a
                  href={state.results.wikipedia}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--tomato)', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  Read more on Wikipedia <ExternalLink size={11} />
                </a>
                <span className="label" style={{ fontSize: 9, color: 'var(--ink-faint)' }}>
                  {state.source === 'library' ? 'Curated' : 'Generated'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
