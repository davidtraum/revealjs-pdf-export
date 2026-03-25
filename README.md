# revealjs-pdf-export
Reveal.js to pdf export with original browser rendering

## Installation

```bash
npm install -g revealjs-pdf-export
```

Or use directly via `npx` without installing:

```bash
npx revealjs-pdf-export <url> [output.pdf]
```

## Usage

```
revealjs-pdf-export <url> [output]

Arguments:
  url     URL of the Reveal.js presentation
  output  Output PDF file path (optional, defaults to the page title with .pdf extension)

Options:
  --no-sandbox  Disable Chromium sandbox (useful in CI/Docker environments)
  -h, --help    Display help information
```

### Examples

```bash
# Export to a PDF named after the presentation title
npx revealjs-pdf-export https://example.com/my-presentation

# Export to a specific file
npx revealjs-pdf-export https://example.com/my-presentation output.pdf

# Use in CI environments (no sandbox)
npx revealjs-pdf-export --no-sandbox https://example.com/my-presentation slides.pdf
```

## How it works

1. Opens the Reveal.js presentation in a headless Chromium browser
2. Hides controls, progress bar and slide numbers
3. Iterates through every slide (including vertical slides)
4. Takes a screenshot of each slide
5. Merges all screenshots into a single PDF file
6. Deletes the temporary screenshot files

## Requirements

- Node.js >= 18

## License

MIT

