import json
import os
from typing import Literal

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from google import genai
from google.genai import types
from pydantic import BaseModel

load_dotenv()
API_KEY = os.environ.get("GEMINI_API_KEY")
# a missing key must not crash the import — serverless hosts (Vercel) import this
# module directly, so /classify reports the problem instead; running locally via
# `python app.py` still fails fast at the bottom of this file
client = genai.Client(api_key=API_KEY) if API_KEY else None

app = Flask(__name__)
# frontend downscales photos before upload; this is just a hard safety cap
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

MODEL = "gemini-3.5-flash"

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}


class Item(BaseModel):
    name: str
    bin: Literal["garbage", "recycling", "compost", "hazardous"]
    prep_required: bool
    prep_instructions: str
    warning: str
    explanation: str


class Classification(BaseModel):
    items: list[Item]
    overall_summary: str


PROMPT = """\
You are a waste-sorting assistant for Toronto, Ontario (City of Toronto rules, 2026).
Identify every distinct item or material part in the photo that must be sorted
separately, and classify each into exactly one bin: "garbage", "recycling",
"compost", or "hazardous".

Toronto sorting rules:
- Green Bin (compost): all food waste (fresh, cooked, spoiled); food-soiled paper
  towels and napkins; paper tea bags; dog waste (bagged is fine); soiled/greasy pizza
  boxes. Items labelled "compostable" or "biodegradable" (cups, cutlery, coffee pods,
  compostable bags) are NOT accepted — they go in garbage despite the label, because
  Toronto's Green Bin program cannot process bio-plastics.
- Blue Bin (recycling): clean/dry paper and cardboard; empty pizza boxes (light grease
  is OK per the 2026 rule update); metal and aluminum cans; aluminum foil and trays if
  free of food residue; rigid plastic containers and bottles (rinsed and empty);
  beverage cartons like milk/juice (emptied, no need to flatten); plastic cutlery
  except black or compostable-labelled; clean white styrofoam (soiled, black, or
  smaller than 4"x4" styrofoam is garbage). Containers must be empty and rinsed —
  food residue contaminates the whole batch. (Since Jan 1, 2026 residential recycling
  collection is handled by Circular Materials rather than the City, but the sorting
  rules are effectively unchanged — only mention this if directly relevant.)
- Garbage: anything labelled compostable/biodegradable plastic (cups, cutlery, coffee
  pods, bags); black plastic; plastic straws; wax or parchment paper; plastic
  toothpaste tubes; soiled styrofoam or pieces smaller than 4"x4"; plastic tampon
  applicators and wrappers; foil- or plastic-lined tea bag wrappers; plastic-lined
  disposable coffee cups.
- Hazardous (drop-off depot): batteries, electronics (kettles, toasters, hair dryers,
  phones), CFL/fluorescent light bulbs, paint, propane/helium tanks, motor oil,
  pesticides, needles/syringes. These must NEVER go in any home bin — always include
  a clear warning telling the user to take them to a Drop-Off Depot or participating
  retailer.

Multi-part items — separate parts that sort differently into their own entries:
- Yogurt container: container is recycling after rinsing and drying (prep required);
  foil lids are recyclable if separated and clean, plastic film lids are garbage.
- Disposable coffee cup: cup is garbage (plastic-lined, not accepted in Blue Bin);
  a clean plastic lid is recycling.
- Pizza box: clean/unsoiled parts are recycling; greasy/soiled parts are compost
  (or garbage if heavily contaminated with non-food material).
- Tea bag: paper bag with tea leaves is compost; nylon/silk bags — empty the tea into
  compost, the bag itself is garbage; wrapper is recycling if paper, garbage if
  foil- or plastic-lined.
If you cannot confidently separate parts from the photo, return your best single
classification for the whole item rather than failing.

For every item:
- prep_required / prep_instructions: if the item needs preparation before disposal
  (rinsing, emptying, removing a part), set prep_required true and give a short
  instruction, e.g. "Rinse and dry before placing in the Blue Bin — food residue can
  contaminate other recyclables." Otherwise set prep_required false and use an empty
  string.
- warning: a short prominent warning for hazardous or commonly-misunderstood items,
  e.g. for a battery: "Do not dispose of in regular garbage or recycling. Batteries
  must be taken to a designated hazardous waste drop-off location or participating
  retailer." Empty string if not applicable.
- explanation: 1-2 educational sentences teaching WHY the item belongs in that bin
  (the underlying rule), so the user can sort similar items correctly next time —
  not just a restatement of the answer.
- overall_summary: one brief sentence summarizing the sort when multiple items were
  detected; empty string for a single item.
If the photo contains no identifiable waste item, return an empty items array.
"""


@app.route("/")
def index():
    return render_template("index.html")


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"error": "Image is too large (max 10 MB)."}), 413


@app.route("/classify", methods=["POST"])
def classify():
    if client is None:
        return jsonify({"error": "Server is missing GEMINI_API_KEY — set it in the "
                        "hosting platform's environment variables."}), 500

    photo = request.files.get("photo")
    if photo is None or photo.filename == "":
        return jsonify({"error": "No image uploaded."}), 400
    if photo.mimetype not in ALLOWED_MIME:
        return jsonify({"error": "Unsupported file type — please send a photo."}), 400

    image = types.Part.from_bytes(data=photo.read(), mime_type=photo.mimetype)

    result = None
    last_error = None
    for _attempt in range(2):  # one automatic retry on API/parse failures
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[image, PROMPT],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=Classification,
                    # thinking off: same classification quality, ~2x faster for the live demo
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            result = json.loads(response.text)
            break
        except Exception as exc:
            last_error = exc
            app.logger.warning("Gemini attempt %d failed: %s", _attempt + 1, exc)

    if result is None:
        app.logger.error("Gemini classification failed: %s", last_error)
        return jsonify({"error": "Couldn't classify the photo — please try again."}), 502

    if not result.get("items"):
        return jsonify({"error": "No item detected — try a clearer, closer photo."}), 422

    return jsonify(result)


if __name__ == "__main__":
    if not API_KEY:
        raise SystemExit(
            "GEMINI_API_KEY is not set. Copy .env.example to .env and add your Gemini API key "
            "(get one at https://aistudio.google.com/apikey)."
        )
    app.run(debug=True)
