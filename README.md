# Trash Detector Sorter

Camera-based waste-sorting assistant. Take or upload a photo of an item and the app
tells you which bin it goes in — Garbage, Blue Bin Recycling, Green Bin Compost, or
Hazardous/Depot — based on City of Toronto rules, with prep instructions and warnings
where needed. Powered by Flask and the Google Gemini API.

## Setup

1. Install dependencies:

   ```
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and add your Gemini API key
   (get a free one at https://aistudio.google.com/apikey):

   ```
   GEMINI_API_KEY=your-real-key
   ```

3. Run the app:

   ```
   python app.py
   ```

4. Open http://127.0.0.1:5000 — take a photo, or drag & drop / upload one, and hit
   **Sort it**.
