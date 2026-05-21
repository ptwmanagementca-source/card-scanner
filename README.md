# Card Scanner

No API key. No backend. No expiry. Runs 100% on-device using Tesseract OCR.

## Get it on your iPhone — 5 steps

### 1. Create a free GitHub account
Go to github.com and sign up if you don't have one.

### 2. Create a new repository
- Click the + icon top right > New repository
- Name it anything (e.g. `card-scanner`)
- Set it to Public
- Click Create repository

### 3. Upload the files
- On the repo page, click "uploading an existing file"
- Drag the entire contents of this `card-scanner-web` folder into the browser window
- Click Commit changes

### 4. Enable GitHub Pages
- Go to Settings > Pages
- Source: Deploy from a branch
- Branch: main, folder: / (root)
- Click Save
- Wait about 1 minute

Your app is now live at:
`https://YOUR-USERNAME.github.io/card-scanner`

### 5. Add to your iPhone home screen
- Open that URL in Safari on your iPhone
- Tap the Share button (box with arrow)
- Tap Add to Home Screen
- Tap Add

Done. It's on your home screen forever, no maintenance required.

---

## How it works

Everything runs in the browser on your phone:
- Camera opens via the file input (native iOS camera)
- Tesseract.js (loaded from CDN) reads the text off the card
- Regex parsing extracts name, title, company, phone, email, website, address
- You review and fix anything — tap ⌄ next to a field to pick a line directly from the card
- Tap Save to Contacts — iOS opens the .vcf file and imports it to your Contacts app

First scan takes ~10 seconds while the OCR engine loads. After that it's cached and fast.
