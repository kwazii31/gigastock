# GAG2 Flux Deck

A brand-new standalone web app that uses:
https://github.com/jcgaming-official/GAG-2-Predictor

## What it does

- Loads predictor core DATA from script.js
- Loads PETS_DATA from pets.js
- Renders tabs for Seeds, Gears, Crates, Rarest Pets, and Weather keys
- Computes current and next stock quantities using seedAnchor and period
- Updates cycle timer live every second

## Run

1. Open a terminal in this folder.
2. Run:

   py -m http.server 8081

3. Open:

   http://localhost:8081/

## Notes

- This app reads public repository assets through jsDelivr.
- If jsDelivr is blocked on your network, you can switch URLs in app.js to raw.githubusercontent.com equivalents.
