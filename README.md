# FlowTrace QA

Chrome Extension (Manifest V3) that records user interactions on a webpage and automatically maps UI Actions → Network API Calls → Responses → UI Changes. Generates structured flows and exports test automation code (Selenium Java + TestNG, Rest Assured).

## Features

- **UI Action Capture**: Records clicks, input, navigation with stable selectors
- **Network Tracking**: Tracks fetch/XHR requests with full request/response data
- **Smart Correlation**: Correlates UI actions to API calls using timing, importance, keyword overlap, and DOM evidence
- **Flow Model**: Structured QA-oriented steps with assertions, variables, and confidence scoring
- **DevTools Panel**: Recording control, flow review, and export workspace
- **Code Export**: Generates Selenium (Java + TestNG) and Rest Assured test code

## Project Structure

```
extension/
├── manifest.json        # MV3 extension config
├── background.js        # Service worker, event coordinator
├── content.js           # UI action capture, DOM mutation observer
├── devtools.js          # DevTools panel creation
├── panel.html/panel.js  # DevTools panel UI
├── inpage-interceptor.js
├── devtools.html
└── utils/
    ├── selector.js      # Stable selector generation
    ├── correlation.js   # UI-API correlation logic
    └── exporter.js      # Code generation (Selenium/Rest Assured)

test-app/                # Bundled test application
```

## Installation

1. Open Chrome and enable **Developer mode** (Settings → Extensions)
2. Click **Load unpacked**
3. Select the `extension/` folder
4. Open DevTools (F12) → **FlowTrace** panel

## Usage

1. Navigate to a webpage
2. Click **Start Recording** in the FlowTrace panel
3. Interact with the page (clicks, form inputs, navigation)
4. Click **Stop Recording**
5. Review correlated steps in the panel
6. Toggle API relevance, add assertions, adjust confidence
7. Export to **Selenium Java**, **Rest Assured**, or **JSON**

## Flow Model

Steps include:
- **Action**: Triggering UI event with selector candidates
- **APIs**: Correlated network requests (relevant/ignored/noise)
- **Outcome**: DOM changes, URL changes, state transitions
- **Assertions**: UI and API verifications
- **Variables**: Extracted and consumed values
- **Confidence**: Score with explainable reasons

## Requirements

- Chrome browser (latest)
- Developer mode enabled

## Testing

Use the bundled `test-app/` to validate the extension:
- Open `test-app/index.html` in Chrome
- Record interactions and verify correlation accuracy
- Test export code generation
