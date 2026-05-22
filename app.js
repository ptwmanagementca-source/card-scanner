'use strict';

// ── Parsing ───────────────────────────────────────────────────────────────────

const TITLE_KEYWORDS = [
  'engineer','manager','director','vp','vice president','ceo','cfo','cto',
  'coo','president','associate','agent','analyst','consultant','developer',
  'designer','founder','partner','sales','marketing','realtor','broker',
  'advisor','coordinator','specialist','executive','officer','supervisor',
  'lead','head','principal','senior','junior','assistant','administrator',
  'representative','account','lending','loan',
];

const COMPANY_RE = /\b(Inc\.?|LLC|Corp\.?|Ltd\.?|Group|Properties|Realty|Associates|Partners|Solutions|Company|Agency|Services|Consulting|Management|Enterprise|Enterprises|Foundation|Institute|International|Worldwide|Holdings|Ventures|Capital|Trust|Bank|Law|Legal|Team|Lending|Financial|Mortgage|Insurance|Investments?|Advisors?)\b/i;
const STREET_RE  = /\b(Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Suite|Ste|Floor|Fl)\b\.?/i;
const STATE_RE   = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/;
const ZIP_RE     = /\b\d{5}(-\d{4})?\b/;
// License number patterns — captured as their own field, excluded from company detection
const LICENSE_RE = /\b(NMLS|DRE|BRE|NPN|CalBRE|CALDRE|License|Lic\.?)\b[\s#:IDid\.]*(\d+)/i;
const JUNK_RE    = /\b(NMLS|DRE|BRE|NPN|CalBRE|CALDRE|EIN)\b[\s#:IDid\.]*\d+/i;

// OCR often merges a logo (ALL CAPS) with the name on the same line: "CHASE) KathyLiu"
// Split those into two separate lines so each can be parsed correctly.
function splitMixedLines(lines) {
  const out = [];
  for (const line of lines) {
    // Pattern: ALLCAPS word(s) followed by ) or space then a Title-case word
    const m = line.match(/^([A-Z][A-Z\s]{1,30}?)\s*[)]\s*([A-Z][a-zA-Z].*)$/);
    if (m) {
      out.push(m[1].trim());   // e.g. "CHASE"
      out.push(m[2].trim());   // e.g. "KathyLiu"
    } else {
      out.push(line);
    }
  }
  return out;
}

// OCR sometimes drops the space in a name: "KathyLiu" → "Kathy Liu"
function fixCamelCase(str) {
  return str.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

// Title-case a string. Keeps short all-caps words as acronyms (LLC, DRE, CPC, VP…)
function toTitleCase(str) {
  if (!str) return str;
  return str
    .split(/\s+/)
    .map(word => {
      // 2-4 letter all-caps word → treat as acronym, leave alone
      if (/^[A-Z]{2,4}$/.test(word)) return word;
      // Everything else → Title Case
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

// Email: OCR sometimes inserts spaces inside: "kathy.a. liu@chase.com"
function extractEmail(rawText) {
  // Clean spaces around . and @ that OCR introduced, then match
  const cleaned = rawText
    .replace(/([a-zA-Z0-9_%+\-])\s+([._%+\-][a-zA-Z0-9])/g, '$1$2')
    .replace(/([a-zA-Z0-9._%+\-])\s+@/g, '$1@')
    .replace(/@\s+([a-zA-Z])/g, '@$1')
    .replace(/\.\s+([a-zA-Z0-9])/g, '.$1');
  const m = cleaned.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : '';
}

// Phone: strip fax lines entirely, then strip call prefixes like "T:", "Tel:"
function extractPhone(rawText) {
  const noFax = rawText.replace(/^.*\b(?:Fax|Facsimile)\b.*$/gim, '');
  const stripped = noFax.replace(/\b(?:Tel|Telephone|Phone|Ph|Cell|Mobile|T|M|C)\.?\s*:/gi, '');
  const pats = [
    /\+?1?[\s.\-]?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/,
    /\(\d{3}\)\s*\d{3}[\s.\-]\d{4}/,
    /\d{3}[\s.\-]\d{3}[\s.\-]\d{4}/,
  ];
  for (const p of pats) { const m = stripped.match(p); if (m) return m[0].trim(); }
  return '';
}

function extractWebsite(t) {
  const m = t.match(/https?:\/\/[^\s]+|www\.[^\s]+/i);
  return m ? m[0] : '';
}

function extractLicense(rawText) {
  const m = rawText.match(LICENSE_RE);
  if (!m) return '';
  const prefix = m[1].toUpperCase().replace(/LIC\.?/, 'License');
  return `${prefix} #${m[2]}`;
}

function isNameLike(line) {
  const t = line.trim();
  if (!t || /\d/.test(t) || /@/.test(t)) return false;
  if (/[^a-zA-Z\s\-'.]/.test(t)) return false;
  if (t === t.toUpperCase() && t.length > 4) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  // Each word starts with uppercase
  return words.every(w => w.length && w[0] === w[0].toUpperCase() && /[a-zA-Z]/.test(w[0]));
}

function isCompanyLike(line) {
  const t = line.trim();
  if (!t || /@/.test(t) || JUNK_RE.test(t)) return false;
  // Pure ALL CAPS word(s) with no digits = strong company signal
  const allCaps = t === t.toUpperCase() && /[A-Z]{2,}/.test(t) && !/\d/.test(t);
  return allCaps || COMPANY_RE.test(t);
}

function isAddressLike(line) {
  const t = line.trim();
  return /^\d+\s+\w/.test(t) || ZIP_RE.test(t) || (STATE_RE.test(t) && /\d/.test(t)) || STREET_RE.test(t);
}

function parseText(rawText) {
  const email   = extractEmail(rawText);
  const phone   = extractPhone(rawText);
  const website = extractWebsite(rawText);
  const license = extractLicense(rawText);

  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  // Split logo+name merged lines before parsing
  const lines = splitMixedLines(rawLines);
  const used  = new Set();

  for (const l of lines) {
    if (email   && l.replace(/\s/g,'').includes(email.replace(/\s/g,''))) used.add(l);
    if (phone   && l.replace(/\D/g,'').includes(phone.replace(/\D/g,'').slice(0,7))) used.add(l);
    if (website && l.includes(website.replace(/https?:\/\//,'').split('/')[0])) used.add(l);
    if (license && LICENSE_RE.test(l)) used.add(l);
  }

  // 1. Company — grab ALLCAPS brand line before anything else
  let company = '';
  for (const l of lines) {
    if (!used.has(l) && isCompanyLike(l)) { company = toTitleCase(l); used.add(l); break; }
  }

  // 2. Job title — must come before name so "Real Estate Agent" isn't claimed as a name
  let jobTitle = '';
  for (const l of lines) {
    if (!used.has(l) && TITLE_KEYWORDS.some(kw => l.toLowerCase().includes(kw))) {
      jobTitle = toTitleCase(l); used.add(l); break;
    }
  }

  // 3. Name — now safe, title keywords are already claimed
  let name = '';
  for (const l of lines) {
    if (!used.has(l) && isNameLike(l)) { name = toTitleCase(fixCamelCase(l)); used.add(l); break; }
  }
  // Fallback: first unused line
  if (!name) {
    const f = lines.find(l => !used.has(l));
    if (f) { name = toTitleCase(fixCamelCase(f)); used.add(f); }
  }

  // Company fallback: title-case multi-word line
  if (!company) {
    for (const l of lines) {
      if (!used.has(l) && !JUNK_RE.test(l)) {
        const words = l.split(/\s+/);
        if (words.every(w => !w.length || (w[0] === w[0].toUpperCase() && /[a-zA-Z]/.test(w[0])))
            && words.length >= 2 && !/\d/.test(l) && !/@/.test(l)) {
          company = toTitleCase(l); used.add(l); break;
        }
      }
    }
  }

  const addrLines = [];
  for (const l of lines) {
    if (!used.has(l) && isAddressLike(l)) { addrLines.push(l); used.add(l); }
  }

  return { name, jobTitle, license, company, phone, email, website, address: addrLines.join(', '), rawLines };
}

// ── OCR ───────────────────────────────────────────────────────────────────────

let ocrWorker = null;

async function getWorker() {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker('eng');
    // PSM 11 = sparse text, best for business cards with scattered layout
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '11' });
  }
  return ocrWorker;
}

// ── Image utils ───────────────────────────────────────────────────────────────

function compressImage(dataUrl, maxDim = 1600) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.src = dataUrl;
  });
}

// Otsu's method: finds the optimal threshold to split foreground/background
function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > maxVar) { maxVar = v; threshold = t; }
  }
  return threshold;
}

// Upscale + binarize: makes text pure black on white for best OCR results
function preprocessForOCR(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      // Upscale so the long side is at least 2400px — Tesseract reads bigger images much better
      const scale = Math.max(1, 2400 / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const imgData = ctx.getImageData(0, 0, w, h);
      const px = imgData.data;

      // To grayscale
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < px.length; i += 4) {
        gray[i >> 2] = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      }

      // Binarize with Otsu threshold — pure black/white, no gray
      const t = otsuThreshold(gray);
      for (let i = 0; i < px.length; i += 4) {
        const v = gray[i >> 2] > t ? 255 : 0;
        px[i] = px[i + 1] = px[i + 2] = v;
        px[i + 3] = 255;
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(c.toDataURL('image/png')); // PNG keeps it lossless after binarization
    };
    img.src = dataUrl;
  });
}

// ── State & UI ────────────────────────────────────────────────────────────────

const FIELDS = [
  { key: 'name',     label: 'Name',    required: true,  inputMode: 'text' },
  { key: 'jobTitle', label: 'Title',     required: false, inputMode: 'text' },
  { key: 'license',  label: 'License #', required: false, inputMode: 'text' },
  { key: 'company',  label: 'Company',   required: false, inputMode: 'text' },
  { key: 'phone',    label: 'Phone',   required: false, inputMode: 'tel' },
  { key: 'email',    label: 'Email',   required: false, inputMode: 'email' },
  { key: 'website',  label: 'Website', required: false, inputMode: 'url' },
  { key: 'address',  label: 'Address', required: false, inputMode: 'text' },
];

let contact = {};
let rawLines = [];
let capturedDataUrl = null;
let activePickerField = null;

function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setLoadingText(msg) {
  document.getElementById('loading-msg').textContent = msg;
}

// Pre-warm Tesseract silently on page load so the first scan is instant
window.addEventListener('load', () => getWorker().catch(() => {}));

// ── Scan flow ─────────────────────────────────────────────────────────────────

document.getElementById('btn-scan').addEventListener('click', () => {
  document.getElementById('camera-input').click();
});

document.getElementById('btn-library').addEventListener('click', () => {
  document.getElementById('library-input').click();
});

async function processFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async ev => {
    const compressed = await compressImage(ev.target.result);
    capturedDataUrl = compressed;
    document.getElementById('loading-photo').src = compressed;
    show('view-loading');

    try {
      setLoadingText('Loading OCR engine...');
      const worker = await getWorker();

      setLoadingText('Reading card...');
      const processed = await preprocessForOCR(compressed);
      const { data: { text } } = await worker.recognize(processed);

      const usefulCount = text.split('\n').map(l => l.trim()).filter(looksUseful).length;
      if (usefulCount < 2) {
        show('view-home');
        alert('Couldn\'t read the card clearly.\n\nTips:\n• Lay it flat on a dark surface\n• Fill the whole frame\n• Make sure it\'s in focus');
        return;
      }

      const parsed = parseText(text);
      rawLines = parsed.rawLines;
      contact  = { ...parsed, license: parsed.license || '', notes: '' };
      delete contact.rawLines;

      renderReview();
      show('view-review');
    } catch (err) {
      console.error(err);
      alert('Could not read the card. Try better lighting or a cleaner photo.');
      show('view-home');
    }
  };
  reader.readAsDataURL(file);
}

document.getElementById('camera-input').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  processFile(file);
});

document.getElementById('library-input').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  processFile(file);
});

// ── Review ────────────────────────────────────────────────────────────────────

function renderReview() {
  document.getElementById('review-photo').src = capturedDataUrl;
  document.getElementById('field-notes').value = '';

  const container = document.getElementById('fields');
  container.innerHTML = '';

  FIELDS.forEach(({ key, label, required, inputMode }) => {
    const row = document.createElement('div');
    row.className = 'field-row';

    const top = document.createElement('div');
    top.className = 'field-row-top';

    const lbl = document.createElement('span');
    lbl.className = 'field-label';
    lbl.id = `label-${key}`;
    lbl.textContent = label + (required ? ' *' : '');

    const btn = document.createElement('button');
    btn.className = 'pick-btn';
    btn.textContent = '⌄';
    btn.addEventListener('click', () => openPicker(key, label));

    top.appendChild(lbl);
    top.appendChild(btn);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'field-input';
    input.id = `input-${key}`;
    input.value = contact[key] || '';
    input.setAttribute('inputmode', inputMode);
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocapitalize', ['tel','email','url'].includes(inputMode) ? 'off' : 'words');
    input.setAttribute('placeholder', '—');
    input.addEventListener('input', ev => {
      contact[key] = ev.target.value;
      if (key === 'name') clearNameError();
    });

    row.appendChild(top);
    row.appendChild(input);
    container.appendChild(row);
  });
}

// ── Picker ────────────────────────────────────────────────────────────────────

// Keep a line if it looks like real card content, not an OCR fragment.
function looksUseful(line) {
  const t = line.trim();
  if (t.length < 4) return false;

  // Always keep lines with clear structured data
  if (/@/.test(t))                         return true; // email
  if (/https?:\/\/|www\./i.test(t))        return true; // URL
  if (/\d{3}[\s.\-]\d{3}/.test(t))        return true; // phone-like
  if (/\b\d{5}\b/.test(t))                return true; // zip code
  if (LICENSE_RE.test(t))                  return true; // license number

  // Text lines need at least one real word (3+ consecutive letters)
  if (!/[a-zA-Z]{3,}/.test(t)) return false;

  // And a reasonable letter density — filters "4,b" or "a:b 12"
  const letters = (t.match(/[a-zA-Z]/g) || []).length;
  if (letters / t.length < 0.35) return false;

  return true;
}

function openPicker(fieldKey, fieldLabel) {
  activePickerField = fieldKey;
  document.getElementById('picker-title').textContent = fieldLabel;

  const list = document.getElementById('picker-list');
  list.innerHTML = '';
  rawLines.filter(looksUseful).forEach(line => {
    const btn = document.createElement('button');
    btn.className = 'picker-item';
    btn.textContent = line;
    btn.addEventListener('click', () => {
      contact[activePickerField] = line;
      const inp = document.getElementById(`input-${activePickerField}`);
      if (inp) { inp.value = line; if (activePickerField === 'name') clearNameError(); }
      closePicker();
    });
    list.appendChild(btn);
  });

  document.getElementById('picker-overlay').classList.remove('hidden');
}

function closePicker() {
  document.getElementById('picker-overlay').classList.add('hidden');
  activePickerField = null;
}

document.getElementById('picker-cancel').addEventListener('click', closePicker);
document.getElementById('picker-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('picker-overlay')) closePicker();
});

// ── Save ──────────────────────────────────────────────────────────────────────

document.getElementById('btn-save').addEventListener('click', () => {
  FIELDS.forEach(({ key }) => {
    const inp = document.getElementById(`input-${key}`);
    if (inp) contact[key] = inp.value;
  });
  contact.notes = document.getElementById('field-notes').value;

  if (!contact.name.trim()) { showNameError(); return; }

  const blob = new Blob([buildVCF(contact)], { type: 'text/vcard' });
  window.open(URL.createObjectURL(blob));
});

function showNameError() {
  document.getElementById('label-name')?.classList.add('error');
  const inp = document.getElementById('input-name');
  if (inp) { inp.classList.add('error'); inp.focus(); }
}
function clearNameError() {
  document.getElementById('label-name')?.classList.remove('error');
  document.getElementById('input-name')?.classList.remove('error');
}

document.getElementById('btn-rescan').addEventListener('click', () => show('view-home'));

// ── VCF ───────────────────────────────────────────────────────────────────────

function buildVCF(c) {
  const parts = (c.name || '').trim().split(/\s+/);
  const rows = [
    'BEGIN:VCARD', 'VERSION:3.0',
    `FN:${esc(c.name)}`,
    `N:${esc(parts.slice(1).join(' '))};${esc(parts[0])};;;`,
  ];
  if (c.company)  rows.push(`ORG:${esc(c.company)}`);
  if (c.jobTitle) rows.push(`TITLE:${esc(c.jobTitle)}`);
  if (c.phone)    rows.push(`TEL;TYPE=WORK,VOICE:${esc(c.phone)}`);
  if (c.email)    rows.push(`EMAIL;TYPE=WORK:${esc(c.email)}`);
  if (c.website)  rows.push(`URL:${esc(c.website)}`);
  if (c.address)  rows.push(`ADR;TYPE=WORK:;;${esc(c.address)};;;;`);
  const noteParts = [c.license, c.notes].filter(Boolean);
  if (noteParts.length) rows.push(`NOTE:${esc(noteParts.join(' | '))}`);
  rows.push('END:VCARD');
  return rows.join('\r\n');
}

function esc(s) {
  return (s || '').replace(/[\\,;]/g, ch => '\\' + ch).replace(/\n/g, '\\n');
}
