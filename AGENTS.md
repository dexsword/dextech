# AGENTS.md

This file provides guidelines for agentic coding agents working in the Dex Tech codebase.

## Project Overview

Dex Tech is a static business website (HTML/CSS/JavaScript) for a tech support company in Henderson, NV. It provides information about services, pricing, and contact options including cryptocurrency donations.

**Tech Stack:** Vanilla HTML5, CSS3, JavaScript (ES6+), no build system

---

## Build/Lint/Test Commands

### No Build System
This is a static site with no build tools. Files are served directly.

### Testing (Browser-Based)
Tests are in `tests.js` and run in the browser console:

1. Open `index.html` in a browser
2. Open Developer Console (F12)
3. Uncomment the test script in HTML (line 252):
   ```html
   <!-- Change this: -->
   <!-- <script src="tests.js" defer></script> --!>
   <!-- To this: -->
   <script src="tests.js" defer></script>
   ```
4. Refresh page - tests run automatically on DOMContentLoaded
5. Or paste tests.js content directly into console
6. Call `runAllTests()` to re-run tests

**Test Categories:**
- QR code display toggle functionality
- Copy to clipboard functionality  
- Smooth scrolling navigation

### Manual Testing Checklist
- Open site in multiple browsers
- Test all navigation links
- Verify QR code buttons show/hide correctly
- Test clipboard copy buttons
- Check responsive design on mobile view
- Verify all external links work (Stripe, Typeform)

---

## Code Style Guidelines

### General Principles
- Keep code simple and readable - no build tools means simple deployment
- Ensure cross-browser compatibility (Chrome, Firefox, Safari, Edge)
- Mobile-first responsive design
- Semantic HTML for accessibility

### HTML Conventions

**Structure:**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="...">
  <title>Page Title</title>
  <!-- External resources -->
  <!-- Styles -->
</head>
<body>
  <!-- Content -->
  <script src="script.js"></script>
</body>
</html>
```

**Requirements:**
- Always include `<!DOCTYPE html>` and `lang="en"`
- Use semantic elements: `<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`
- Include meta viewport for mobile
- Use lowercase for HTML tags and attributes
- Quote all attribute values
- Use 2-space indentation

### CSS Conventions

**Style:**
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.class-name {
  property: value;
  /* Use shorthand where appropriate */
}
```

**Rules:**
- Use CSS custom properties for repeated values (colors, spacing)
- BEM-lite naming: `.component-subcomponent`
- Use classes over inline styles except for dynamic values
- 2-space indentation
- No `!important` unless absolutely necessary
- Mobile-first media queries: `@media (min-width: ...)`

### JavaScript Conventions

**Functions:**
```javascript
function functionName(param1, param2) {
  const localVar = 'value';
  
  if (!localVar) {
    console.error('Error message');
    return;
  }
  
  // Main logic
  return result;
}
```

**Event Listeners:**
```javascript
document.addEventListener('DOMContentLoaded', function() {
  // DOM is ready
  const elements = document.querySelectorAll('.selector');
  
  elements.forEach(el => {
    el.addEventListener('click', function(event) {
      event.preventDefault();
      // Handle click
    });
  });
});
```

**Rules:**
- Use `const` by default, `let` when reassignment needed, avoid `var`
- Use template literals for string interpolation
- Use arrow functions for callbacks: `array.forEach(item => {})`
- Use `===` and `!==` instead of `==` and `!=`
- Always check if elements exist before manipulating
- Use `console.error()` for errors, `console.warn()` for warnings
- Handle promise rejections in `.then(resolve, reject)` pattern

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| HTML IDs | kebab-case | `id="hero-section"` |
| HTML Classes | kebab-case | `class="service-card"` |
| CSS Variables | kebab-case | `--primary-color` |
| JavaScript Functions | camelCase | `displayImage()` |
| JavaScript Variables | camelCase | `targetElement` |
| JavaScript Constants | UPPER_SNAKE | `MAX_RETRIES` |

### Error Handling

```javascript
// Check element existence
const element = document.getElementById('targetId');
if (!element) {
  console.error(`Element with ID "targetId" not found.`);
  return;
}

// Handle async operations
navigator.clipboard.writeText(text).then(
  function() { /* success */ },
  function(err) { 
    console.error('Clipboard error:', err); 
  }
);

// Try-catch for risky operations
try {
  const result = document.querySelector(selector);
} catch (e) {
  console.error('Invalid selector:', selector, e);
}
```

### Accessibility

- Use semantic HTML elements
- Include `alt` text for images
- Ensure color contrast ratios meet WCAG AA
- Use `<button>` for interactive elements, not `<div>` or `<a>`
- Include `aria-label` where purpose isn't clear from text
- Ensure keyboard navigation works

### File Organization

```
/
├── index.html          # Main homepage
├── support.html        # Support/tips page (donations)
├── privacy.html       # Privacy policy
├── style.css           # Main stylesheet
├── script.js           # Main JavaScript
├── tests.js            # Browser-based tests (commented out in production)
├── favicon.png         # Site favicon
└── *.jpg               # Image assets (QR codes, backgrounds)
```

---

## Git Workflow

1. Create a new branch for changes: `git checkout -b feature/description`
2. Make changes and test locally
3. Commit with clear message: `git commit -m "Description of changes"`
4. Push branch: `git push -u origin feature/description`
5. Create pull request for review

**Note:** Never commit secrets or credentials to the repository.
