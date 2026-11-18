# Galleon

A drivable 17th century galleon with a living crew, built entirely in code with three.js (r187) and Next.js.

- Procedural hull, masts, sails, rigging, cannon ports and lanterns (no external models)
- Captain, mate, helmsman, lookout, climbing sailors and deck crew, all procedural and animated
- Square-rigger sailing model: the wind direction decides how well the sails drive the ship
- Calm moonlit sea (Gerstner waves, low swell), stars, wake foam, bloom and film grain

## Controls

- W / S (or Up / Down): set more / less sail
- A / D (or Left / Right): rudder
- Drag to orbit the camera, scroll to zoom. On touch devices use the on-screen pads.
- `?storm=1` turns on the storm weather (big waves, rain, lightning)

## Adding another ship

Write a ship builder (see `lib/ship.ts`), a crew layout and a physics profile, then add a `VesselSpec`
to `lib/vessels.ts`.

## Run

    npm install
    npm run dev

## Deploy

Push to GitHub and import the repo in Vercel (no environment variables needed).
