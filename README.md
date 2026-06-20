# Trickroom

> The dimensions twisted!

## Design is Code

Trickroom is a local design workspace for web interfaces. It is built heavily around React and Tailwind, so what you make stays close to how those libraries operate. It also lives inside your codebase by design, so you can leverage the wonders of git!

Trickroom is not trying to be a general-purpose image editor! It is a small, focused place to lay the foundation for your product's UI with the same building blocks you use in code.

## Usage

Install Trickroom globally:

```sh
npm install -g trickroom
```

Then run it from the project you want to design in:

```sh
trickroom .
```

Or pass a project directory explicitly:

```sh
trickroom /path/to/your/project
```

Trickroom currently opens a local browser tab on port `18100` and onboards you on setting up your project, and works best if you initialize it inside your web ui / styling library!

Create a design file, start adding layers and apply Tailwind class names directly. Changes autosave as JSON files under `.trickroom/designs`, meaning both tracking/version control as well as reviewing designs as code are as easy as can be.

## Contributing

For local development, clone the repository and install dependencies:

```sh
pnpm install
pnpm build
node bin/trickroom.js /path/to/your/project
```

During development you can run the Vite server directly:

```sh
pnpm dev
```

Run the test suite with:

```sh
pnpm test
```

## What's Next

Trickroom is early, and the current built-in component library is intentionally small but is meant to be a solid foundation for what's to come. The main focus is for this tool to support my own day time job.

Off the cuff, this is what should be coming in the near future:
- [ ] Browser tab is nice, Electron app is nicer
- [ ] Tailwind theme files as design-token sources
- [ ] Sync design tokens to your `.trickroom` folder
- [ ] Emulate viewports
- [ ] Richer support for component libraries like Base UI
- [ ] Library-specific recipes - i.e. placing the building blocks like, for example, [Base UI's Field Component](https://base-ui.com/react/components/field)
- [ ] User-defined Components, component Variants and Slots, building on all the aforementioned steps!
- [ ] Handle resolving out-of-theme variables (think shadcn)
- [ ] Variants / modes (specifically Dark Mode)
- [ ] Eventually support for libraries like Radix UI, Headless UI and making the library/registry system easily extensible

## Extremely Random

The name `trickroom` is a nod to the fact that, just like Tailwind, Trick Room is an important speed control move in competitive Pokémon / VGC.

## License

MIT
