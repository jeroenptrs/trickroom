# Copywriting guideline

This page is the working brief for anyone who writes text for Trickroom, human or agent. It holds the product facts you may state, the terms, the tone of voice, and the rules for each kind of text. It needs no other style guide.

## Know what you own

You own three kinds of text.

- **In-app UI strings.** Labels, buttons, tooltips, placeholders, empty states, errors, toasts, and dialogs under `src/components/`.
- **User docs and the README.** `README.md` and the pages in `docs/`, except `docs/proposals/`.
- **Marketing and release text.** Website copy, the npm description, release notes, and announcements. None of these exist in the repo yet.

You do not own text that agents read. Leave these alone, and report a problem with them instead of editing:

- MCP tool descriptions, guide topics, and server instructions in `src/mcp/`.
- Error messages that the server writes in `src/server.ts`, `src/services/`, and `src/routes/`.
- CLI output in `src/cli/` and `bin/`.

The UI prints some server errors verbatim. If a raw server message reads badly on screen, give it a title at the UI call site and report the message itself.

### Resolve conflicts in this order

1. The code. A string, a file path, a count, or a behavior is whatever the code says today.
2. `CLAUDE.md`, for what the product is and is not.
3. This page, for terms, tone, and rules.
4. The existing copy. It is evidence of terms and formats, never of tone. Most of it predates this page.

## State only facts you can check

Verify every claim against the code before you publish it. The docs drift. The README says the MCP server has 26 tools, and the code registers 27. Avoid counts in prose where a count adds nothing. Where you need one, count it yourself.

### What Trickroom is

- Trickroom is a local-first design tool for web UI. It runs on your machine, in a browser, against a real project folder.
- A design is a JSON tree of React elements with Tailwind class strings. The files live in the project under `.trickroom/` and are meant to be committed.
- Designers work in the browser app. Agents work on the same designs through an MCP server. A designer leaves annotations on layers, and an agent answers them with changes.
- A system holds the tokens, icons, assets, fonts, and components that designs use. Trickroom reads the tokens from the project's own Tailwind CSS.
- Trickroom ships three libraries. The built-in `trickroom` library has `container` and `text`. `base-ui` and `charts` are separate component libraries, not built-ins.
- `trickroom codegen` writes tailwind-variants files from published components. `trickroom lint` checks how the app and the designs use a system.
- The ethos is "Design is Code". Write it with that capitalization, in quotes, and at most once per page.

### Who you write for

The reader is a designer or a developer who works in a codebase. They know what a class, a token, a branch, and a pull request are. They may not know Trickroom's own terms, so those come from the list of terms below and nowhere else.

### What Trickroom is not

Never describe Trickroom as any of these, and never imply them.

- A no-code or low-code website builder.
- A replacement for Figma, or a bitmap or vector editor.
- A tool that edits your application source. Trickroom writes under `.trickroom/` and `~/.trickroom/`. The one exception is `trickroom codegen`, which writes variants files to the `outDir` you configure.
- A cloud service. There are no accounts, no hosted storage, and no sync server.
- A proprietary format. The files are plain JSON that you can read, diff, and render to HTML and CSS yourself.
- A tool with visual style controls. There are no color pickers or spacing boxes. You write Tailwind classes.

### Reference facts

| Fact | Value | Where to check |
| --- | --- | --- |
| Name | Trickroom. One word, capital T only. | |
| CLI and npm package | `trickroom`, in code font | `package.json` |
| Version | 0.1.0 | `package.json` |
| License | AGPL-3.0, with a commercial license on request | `LICENSE`, `README.md` |
| Install | `npm install -g trickroom` | `README.md` |
| Start | `trickroom serve .` | `README.md` |
| Default address | `http://localhost:18100/` | `README.md` |
| Project data | `.trickroom/` in the project, committed | `docs/project-files.md` |
| Per-user data | `~/.trickroom/`, never committed | `docs/project-files.md` |
| Stack it works with | React, Tailwind v4, MCP | `CLAUDE.md` |

Do not write about a feature before it is on `main`. Do not promise dates or future features.

## Call each thing by one name

Use the term in the first column everywhere. Write terms in lowercase, except at the start of a sentence. The file format and the code sometimes use another word. That word stays in the code and in the reference docs that describe the files.

| Term | Meaning | Never write |
| --- | --- | --- |
| project | The codebase that holds a `.trickroom` folder | workspace, repo |
| design | One design, with its boards | document, canvas, page, file (in the UI) |
| board | A root layer in a design. One responsive screen or one state. | artboard, frame, page, screen |
| layer | Anything placed in a design or in a component | node, element (for something placed) |
| library | A headless component library | registry (in the UI) |
| element | A library item that you can add as a layer | primitive, component (for a library item) |
| recipe | A library-owned group of elements that forms one UI concept, such as a dialog or a menu | pattern, template, block |
| system | The tokens, icons, assets, fonts, and components that a design uses | design system, theme |
| CSS file | The Tailwind CSS that a system reads its tokens from | stylesheet, CSS path, entry |
| token | One named value in a system, such as a color | variable, style |
| Tailwind default | A token or class that comes from Tailwind and not from the project | baseline |
| icon | An SVG from an icon folder | |
| asset | An image or a video that is not an SVG | media, file |
| component | A user-owned set of layers and variants, kept in a system | symbol, master, system component |
| variant | One axis of variation of a component, such as size | prop, option |
| compound variant | Classes that apply to one combination of variant values | |
| slot | A place in a component or a recipe that takes the user's own layers | placeholder, hole |
| instance | A placed copy of a component or a recipe | attached instance, usage, copy |
| detach | Cut an instance loose from its component or recipe | unlink, flatten |
| class | A Tailwind class on a layer. `className` only for the prop. | style, utility, class name |
| draft | The unpublished state of a component | |
| publish | Make a component draft a numbered version | release, save |
| annotation | A remark that a designer leaves on a layer, a board, or a design for an agent | comment, feedback, note |
| round | The batch of annotations that a designer sends for an agent to handle | session, batch |
| memory note | A kept note on intent, conventions, or decisions. "Note" on later mentions. | memory |
| agent | Any AI client that works through MCP | AI, assistant, bot, a product name |
| canvas | The area that shows the boards | stage, artboard area, viewport |
| inspector | The right panel, in both editors, with the selected layer's classes, properties, and annotations | properties panel, right panel, details |
| layers panel | The left panel of the design editor, with the layer tree | layer list, tree, outline |
| sidebar | The left panel of the system editor, with the section tabs and the lists | navigation, menu, left panel |
| expand, collapse | What the panel buttons do to a panel | show, hide, open, close |
| lint, finding, rule | The check, one result of it, and one kind of check | error (for a finding), violation, issue |

Fixed labels, written as shown:

- Annotation states: Draft, Open, Addressed, Needs input, Proposed, Resolved, Resolved by agent, Dismissed, Detached.
- Component states: Not published, Draft, Published.
- MCP access: Off, Read only, Read and write.

## Write terse and technical

The voice is that of a developer tool. It reports a state, a number, or a name, and then it stops. The look of the app is brutalist, and the text matches it.

- **Fragments in titles, labels, and toasts.** "No boards", not "This design has no boards yet". Drop the article in a fragment: "Add board", "Delete layer".
- **Whole sentences in bodies.** Dialog bodies and helper text are short sentences with their articles, because a fragment there reads two ways.
- **Numbers, not words about numbers.** "3 of 5 closed", "12 layers", "0 errors". Never "a few", "some", or "several".
- **The real name.** Show the file, the class, the token, the version, or the branch as it is written in the user's repo: `lint.json`, `p-4`, `v3`. Set it in the mono `value` text variant.
- **Code terms yes, Trickroom internals no.** Use words the user writes or sees in their own codebase: class, token, variant, branch, revision. Do not show Trickroom's internal nouns: node, manifest, hash, payload, store, UUID.
- **Outcome first, cause second, fix on the button.** The title says what did or did not happen. The body names the cause. The action is a button, not a sentence that describes a button.
- **No character.** No jokes, greetings, apologies, reassurance, or praise. No "we", no "please", no "successfully", no "oops". No exclamation marks.
- **No promises about time.** Not "shortly" and not "just a moment". Say what is in progress: "Saving…".

Terse does not mean cryptic. Do not invent abbreviations, do not write arrows or other symbols in place of words, and do not drop a word that carries the meaning. The diff counts that the app already shows, such as `+3 ~1 -2`, are the only symbol shorthand.

### Target voice, from strings in the app today

Most strings in the app predate this voice. These pairs show the direction.

| Today | Target |
| --- | --- |
| No boards yet | No boards |
| Add a board | Add board |
| Could not save | Not saved |
| Could not rename the project | Project not renamed |
| Could not update the recipe | Recipe not updated |
| Optional. You can add a system later. | Optional. |
| Select a component to edit it. | Select a component. |
| Choose a system | Choose system |
| Replace the layer with an instance | Replace layer with instance |
| This can't be undone. | No undo. |
| No systems in this project | No systems |

## Write in-app copy

The app has one language, English, and no message catalog. Strings are written in the JSX.

### Decide whether the text should exist

Most UI writing is the decision not to write. Check each string in this order.

1. If the title and the controls already say it, cut it.
2. If the screen states the fact elsewhere, keep one.
3. If structure can carry the meaning, use structure. A sort indicator replaces "Newest first".
4. If the detail is secondary, move it to a tooltip.

Keep a hint only when the rule cannot be guessed, when the user would lose work, or when a new concept needs one line.

A cut must not remove information. An icon-only button keeps its accessible name, a status dot keeps its text for screen readers, and a fact that the user needs cannot live only in a tooltip.

### Write each element

**Buttons and menu items.** Verb and noun, no article: "Add layer", "Save draft", "Delete board". Never "OK", "Yes", or "Submit". Keep the verb through the flow, so that "Publish" leads to "Publishing…" and then to "Component published".

**Results.** A success and a failure are one pair: "{Object} {past participle}" and "{Object} not {past participle}". "Recipe updated" and "Recipe not updated". "Round closed" and "Round not closed". At the control itself, where the object is on screen, the object can go: "Saved", "Not saved".

**Errors.** The title is the failed result from the pair above. The body is the cause as one short sentence, with the real name in it: "`design.json` changed on disk." The fix is a button: **Reload**. Never print a stack trace, a JSON parse error, or "Something went wrong".

**Toasts.** The result, and at most one action. Nothing else.

**Empty states.** The title is "No {plural noun}": "No boards", "No findings". A filtered list that matches nothing says "No matching {plural noun}". Add one button for the next action when there is one. Add a body line only when the next action is somewhere else: "Run lint to include designs."

**Selection states.** When a pane waits for a selection, give the command: "Select a component."

**In-progress states.** The verb with "-ing" and an ellipsis: "Saving…", "Extracting…".

**Disabled controls.** The tooltip says what unblocks the control: "Select a variant value to pin."

**Destructive actions.** Match the friction to the loss.

- When the action can be undone, do not confirm.
- For a single item with nothing under it, do not confirm.
- For a board, a layer with children, a component, or a system, confirm in a dialog.

The dialog title is the action and the name, as a question: "Delete board "Checkout"?". The body states what goes, with numbers, and then "No undo." when that is true: "Deletes 12 layers. No undo." The confirm button repeats the verb and the noun: **Delete board**. The other button is **Cancel**. Never write "Are you sure?".

**Helper text under a field.** One sentence that states the rule or the format: "Relative to the project folder."

**Placeholders.** A search or a filter field ends with an ellipsis: "Filter designs…". Any other field shows an example value in the format that the field takes: `src/index.css`. A placeholder never replaces a label.

**Tooltips on icon buttons.** The action, then the shortcut in parentheses: "Add layer (A)", "Expand sidebar (Alt+[)". The `aria-label` holds the action without the shortcut.

### Follow the formats that the app already has

- **Sentence case** for everything, including buttons, tabs, and titles. Do not use CSS to change the case of a string. Write the string in the case it renders in.
- **Counts** are a number and a noun, with the plural from the `pluralize` helper in `src/components/project/project-view-utils.ts`: "1 note", "3 notes". Never "note(s)".
- **Progress** is "{n} of {total} {state}", with commas between parts: "1 of 3 closed, 2 waiting on you".
- **Ellipsis** is the single character `…`, never three periods. It marks an in-progress state, a search or filter placeholder, or a command that opens a dialog before it acts ("Delete…").
- **Separators.** Never put `·`, `—`, `|`, or `→` in a string. Use layout, a comma, or a colon.
- **Ranges** use "to": "640 to 1024", not "640–1024".
- **File names** appear as written, also on buttons: **Save lint.json**.
- **Shortcuts** are written as `Alt+[` in the app. Where a shortcut differs per platform, write both: `Ctrl/Cmd + scroll`.
- **Mono** is for ids, paths, classes, tokens, and values. Words are set in the sans body font.

### Check the string where it renders

- Test with the longest real name, with 0, 1, and many, and at the narrowest pane width.
- Use the text primitives in `src/components/ui/`. Do not style a string by hand.
- Tests assert on strings. Search the `*.test.ts` and `*.test.tsx` files for the old text and update them in the same change.
- `docs/user-guide.md` quotes UI strings in bold. Search the docs for the old text and update them in the same change.
- Run `pnpm test`, `biome check --write`, and `node bin/trickroom.js lint --check` before you hand off.
- The lint run enforces part of this page. The `code.text-pattern` rule in `.trickroom/systems/trickroom/lint.json` holds the banned text as patterns, and each finding names the rule it breaks. When you add a ban to this page, add its pattern there. When your change lowers the count, run lint without `--check` and commit the new `lint-report.json`.

## Write docs and the README

Docs use the same voice in whole sentences. They explain what the app does and what it writes to disk, so that a reader can predict it.

- Address the reader as "you", in the present tense. Give instructions as commands: "Click **Add folder**."
- Lead each page and each section with what the reader can do or must know. Background comes after.
- Put the condition before the instruction: "To switch sections, expand the sidebar."
- One instruction per sentence. One thought per sentence elsewhere. Split a sentence that passes 25 words.
- Name the actor. "Trickroom writes the report", not "the report is written".
- Headings are in sentence case and say the point of the section. A task heading starts with a verb: "Start a project". The existing pages use title case. Convert a page when you edit it, and then update every link to its anchors. Search `src/` too, because code comments link to doc anchors.
- Numbered lists for steps, bullets for everything else. Introduce each list with a full sentence.
- UI element names are in bold and match the app character for character. Code, paths, commands, and keys are in code font. Keys in docs are written as `Alt` + `[`.
- No em dashes and no semicolons. Use a period. No "etc.", no "e.g.", and no slashes between alternatives.
- Do not write "simply", "just", "easy", or "quickly" in a procedure.
- State a limit as plainly as a feature. The user guide has a section for current limits. Keep it true.
- A doc page can use a file-format word such as "node" when it describes the file. Say once on that page which UI term it maps to.

## Write marketing and release text

Marketing text is the same voice at a longer length. A claim is a mechanism or a number, never a feeling.

- Say what Trickroom does and how. "Designs are JSON files in your repo, so a design change is a git diff." Not "seamless handoff" and not "design at the speed of thought".
- If a sentence fits another product's site without a change, cut it.
- Do not use these words: seamless, powerful, effortless, magical, intuitive, revolutionary, next-generation, supercharge, unlock, empower, reimagine, AI-powered.
- Do not compare Trickroom with a named product. Describe what Trickroom does and let the reader compare.
- Do not claim what you cannot check in the repo: no performance numbers without a measurement, no user counts, no testimonials.
- "Agents" are collaborators that propose and apply changes through MCP, under a policy that the project sets. Do not write that agents design for you.
- A headline is one concrete claim in sentence case, with no period and no exclamation mark.
- The npm description and other one-line summaries follow this model: "Local-first design tool for web UI. Designs are JSON trees of React elements and Tailwind classes, stored in your repo."

### Release notes

- Write one entry per change that a user can notice. Skip refactors and tests.
- Group entries by area, in the areas that the commit prefixes use: editor, annotations, system, lint, codegen, MCP, CLI.
- Each entry is one sentence in the present tense that says what the user can now do or what now behaves differently: "The lint dashboard opens a finding at its layer."
- Put changes to the files under `.trickroom/` first, each with the migration command or the statement that the migration runs on save.
- Name a fix by its symptom, not by its cause in the code.
- Use the version from `package.json`. Do not invent a version or a date.

## Apply these mechanics everywhere

- **American spelling**: color, center, behavior, catalog, gray. Some docs and comments still use British spelling. Fix a page when you edit it.
- Serial commas. Straight quotes. No emoji.
- Sentence case in every heading, label, and title.
- Bold is for UI element names. Do not use bold for emphasis.
- Keep "only" and "not" next to the word they change.
- Make every "it" and "this" point at one noun. Repeat the noun when in doubt.

## Detect and fix these patterns

1. **Restated UI.** A description that repeats its title or its control. Delete the description.
2. **A sentence where a fragment does.** "There are no boards in this design yet" becomes "No boards".
3. **Vague actions.** "OK", "Yes", "Submit", and "Confirm" become the verb and the noun.
4. **Softened failures.** "Could not", "Unable to", "Failed to", and "Sorry" become "{Object} not {past participle}" and a cause.
5. **Raw errors.** A parse error, a stack trace, or an HTTP status alone. Give it a title from the result pair and keep the raw text out of the title.
6. **Internal nouns.** Node, manifest, hash, payload, and UUID on screen. Use the term from the list, or cut the row.
7. **Synonyms.** Two words for one thing on one screen. Use the term from the list.
8. **Character.** A greeting, a joke, an apology, an exclamation mark, or "successfully". Delete it.
9. **Separators and arrows** inside a string. Use layout, a comma, or a colon.
10. **Lost information.** A cut that removed an accessible name or the only copy of a fact. Restore it.
11. **Unchecked claims.** A count, a feature, or a path that the code does not confirm. Check it or cut it.
12. **Hype words** from the list in the marketing section, in any kind of text. Replace each with the mechanism.
