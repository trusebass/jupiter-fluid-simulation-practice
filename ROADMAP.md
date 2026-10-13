# Roadmap: from a blank page to the Jupiter fluid

The finished version is in `reference/`. Your version grows in `my-hero/`.
Each step ends with something you can see in the browser or the console.
Line numbers point into `reference/fluid.js` unless another file is named. Look at them after you have tried a step yourself, to compare.

The path goes through a slow, simple fluid on the CPU (stage 3) before the fast one on the GPU (stage 4). In plain JavaScript you can print every number and step through it. Once you understand the maths there, WebGL is "only" a new way of running it.

Steps marked **AI round**: you write a short spec, Claude writes the code, you review it. That is practice for the way you will work with AI later: describing what you want precisely, then judging what comes back.

---

## Stage 0 · Tools

- [ ] **0.1 The folder, the terminal, git.** Open `jupiter-fluid/` in VS Code. Terminal basics: `pwd`, `ls`, `cd`. `git init`, then your first commit.
- [ ] **0.2 See the goal.** Start a local server with `python3 -m http.server 8000` in this folder and open <http://localhost:8000/reference/>. Move the cursor over the clouds. Open the browser's developer tools (Cmd+Option+I) and look around.

## Stage 1 · A web page

- [ ] **1.1 A blank page.** Create `my-hero/index.html` by hand: doctype, `<html>`, `<head>`, `<body>`, one line of text. Open it by double-clicking. Find it in the Elements tab of the developer tools.
  *Concepts:* what HTML is (a tree of elements), how the browser reads a file top to bottom.
- [ ] **1.2 The photo, full screen.** An `<img>` from `assets/jupiter/`, and a separate `style.css`. Make it fill the window and crop like the site.
  *Concepts:* CSS selectors, the box model, `position: absolute` + `inset: 0`, `object-fit: cover`, `object-position`. Compare with `reference/style.css`.
- [ ] **1.3 JavaScript.** A `<script>` that prints to the console, then prints the pointer position every time the mouse moves.
  *Concepts:* variables (`const`, `let`), functions, events and listeners, the Console tab.
- [ ] **1.4 Files that import each other.** Move the script into `main.js`, split one function into a second file, `import` it. It breaks when opened by double-click; run the local server and it works.
  *Concepts:* ES modules (`import`/`export`), why the browser refuses modules from `file://`, what a local server does. Splitting code by job.

## Stage 2 · Drawing and time

- [ ] **2.1 A canvas on top of the photo.** Draw a circle where the pointer is.
  *Concepts:* `<canvas>` and its 2D context, canvas pixels vs CSS pixels, `devicePixelRatio` (compare `resize()`, :252).
- [ ] **2.2 The animation loop.** A dot that keeps moving after you let go and slows down, the same on a 60 Hz and a 120 Hz screen.
  *Concepts:* `requestAnimationFrame`, the time step `dt`, decay as `exp(-k·dt)` so the result does not depend on the frame rate (this is what `relax` and `velocityDissipation` do, :15).
- [ ] **2.3 Give it a shape.** Put the dot logic into `createDots(canvas, options)` that returns `{ start, stop, pointer }`. Keep the event listeners in a separate file.
  *Concepts:* a function that builds and returns an object (a "factory"), closures (variables that stay alive inside it), default settings merged with options (`{ ...DEFAULTS, ...options }`, :214). This is the shape of `createJupiter` (:213, returned API at :483) and the reason `fluid.js` has no event listeners while `hero.js` has nothing but.

## Stage 3 · A fluid on the CPU

Plain JavaScript, a grid of about 64 × 64 cells, drawn as coloured squares. Slow, but every value can be printed.

- [ ] **3.1 A grid.** A `Float32Array` holding one number per cell; `idx(i, j)`; draw it. Write `sample(field, x, y)` with bilinear interpolation.
  *Concepts:* a 2D field stored as a 1D array, interpolation, small functions with one job each.
- [ ] **3.2 Advection.** A fixed velocity field (a rotation), and "dye" carried along it by tracing each cell backwards: `q_new(x) = q(x − Δt·u(x))`. Let it run for a minute and watch it blur.
  *Concepts:* semi-Lagrangian advection, why it is stable for any `Δt`, why repeated interpolation blurs. **The blur is why the site never moves the photo itself.**
- [ ] **3.3 Velocity that moves itself.** Velocity becomes a field too (two arrays), advected by itself. The pointer adds a Gaussian push (a "splat", compare :159 and :355). Things pile up and look wrong.
  *Concepts:* the advection term of Navier–Stokes, Gaussian kernels.
- [ ] **3.4 Incompressibility.** Compute divergence, solve for pressure with Jacobi iterations, subtract the gradient. Add a switch to turn it off and compare.
  *Concepts:* ∇·u = 0, the Poisson equation, Jacobi iteration, the Helmholtz–Hodge decomposition, boundary conditions at the walls (:78, :120, :131).
- [ ] **3.5 Damping, viscosity, swirl.** Velocity decay, the neighbour-averaging smoothing (:150), vorticity confinement (:93, :103). Find the checkerboard pattern and see the smoothing remove it.
  *Concepts:* curl, why coarse grids lose small eddies, what the comments in `step()` (:362) mean.
- [ ] **3.6 (optional) The photo on the CPU.** Instead of dye, advect a displacement map and draw the photo through it at low resolution. It moves and stays sharp.
  *Concepts:* the reference map, `d_new(x) = d(x − v·dt) − v·dt` (top of `fluid.js`). Compare with the blur from 3.2.
- [ ] **AI round.** Write a spec for a "debug view" that draws velocity as small arrows on top of your grid. Claude implements it; you review.

## Stage 4 · The same on the GPU (WebGL2)

- [ ] **4.1 Hello, WebGL.** Get a WebGL2 context, draw one triangle that covers the screen (:227), colour it from the pixel position in a fragment shader. Write the shader-compiling helpers by hand once (`compile`, `program`, :558–580).
  *Concepts:* the GPU runs the same small program for every pixel, vertex vs fragment shader, GLSL basics, reading shader compile errors.
- [ ] **4.2 The photo as a texture.** Upload it (`setImage`, :285) and draw it with the same crop as CSS `object-fit: cover` (`updateCover`, :270).
  *Concepts:* textures, uv coordinates, image y-axis flip, deriving the cover-fit scale and offset yourself.
- [ ] **4.3 Drawing into textures.** Framebuffers, two textures that swap roles every frame (`fbo`, `doubleFbo`, :526–556), half-float formats (`pickFormat`, :512). First test: a pointer trail that fades.
  *Concepts:* "ping-pong" (read one, write the other, swap), why a shader cannot read and write the same texture. Write your own small helper for "run this shader into that texture" (compare `use`, :422).
- [ ] **4.4 Port stage 3, one shader at a time.** Splat, advect, divergence, pressure, gradient. Check each against your CPU version.
  *Concepts:* neighbour lookups via `vL`, `vR`, `vT`, `vB` in the vertex shader (:37), uniforms, texel size.
- [ ] **4.5 The rest of the solver.** Curl, vorticity, smoothing, and keeping part of the old pressure as a starting guess (`pressureRetain`, `scale`, :142).

## Stage 5 · Making it Jupiter

- [ ] **5.1 The reference map on the GPU.** First advect the photo colours directly and watch them smear. Then switch to `advectMap` (:68) and `display` (:204).
- [ ] **5.2 Pointer to force.** Coalesced pointer events (`reference/hero.js`), a queue of moves applied once per frame (`pointer`, :304), faster strokes pushing harder and wider, splats spread along the path (`applyMoves`, :313).
  *Concepts:* decoupling input from the frame loop.
- [ ] **5.3 Background drift.** A slow flow that never stops, built as the curl of a moving stream function so it adds no divergence (`forces`, :172).
  *Concepts:* stream functions, why ∇·(∇×ψ) = 0.
- [ ] **5.4 Storms.** Positions in `reference/storms.js`, converted from photo pixels to canvas coordinates (`updateCover`). Angle swept around a storm with `atan2` (`spinStorms`, :341), spin that decays, idle twisting with golden-angle phases (:243).
  *Concepts:* keeping data apart from code, coordinate systems and converting between them.
- [ ] **AI round.** Write the spec for one storm feature you would like that the site does not have. Claude implements, you review.
- [ ] **5.5 Making it robust.** Everything in `reference/hero.js`: reduced motion, no WebGL2 fallback, pausing off-screen (`IntersectionObserver`) and in hidden tabs, choosing the photo size, phone settings, `try`/`catch`.
- [ ] **5.6 Tuning.** Collect all constants in one `DEFAULTS` object. Expose your fluid as `window.jupiter` and use `advance()` and `measure()` (:463, :471) from the console.

## Stage 6 · Wrap-up

- [ ] **6.1 Compare.** Read `reference/fluid.js` top to bottom next to yours. List the differences; for each, decide which version you prefer and why.
- [ ] **6.2 (optional) Ship it.** Replace the hero on your site with your own version.
