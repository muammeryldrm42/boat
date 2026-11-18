# Ghost Galleon

An original spectral galleon built entirely in code with three.js (r187) and Next.js.

- Procedural hull, masts, yards, torn sails, rigging, cannon ports and lanterns (no external models)
- Gerstner wave ocean shader, ship motion driven by the same wave maths
- Storm sky, rain, lightning, mist, bloom and film grain post-processing

## Run

    npm install
    npm run dev

Open http://localhost:3000. Drag to orbit, scroll to zoom. Camera can be set with `?cam=x,y,z`.

## Deploy

Push to GitHub and import the repo in Vercel (no environment variables needed).
