// How to run these tests:
// 1. Open index.html in your browser.
// 2. Open the browser's developer console (usually by pressing F12).
// 3. The test results will be logged to the console automatically when the page loads.
//    Alternatively, you can copy and paste the content of this file into the console and press Enter.
//    Or, call `runAllTests()` in the console to re-run.
// Note: For production, this script should ideally be removed or loaded conditionally.

console.log("Starting UI Tests...");

let totalTests = 0;
let passedTests = 0;

function assertEquals(expected, actual, message) {
    totalTests++;
    if (expected === actual) {
        passedTests++;
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message} - Expected: ${expected}, Actual: ${actual}`);
    }
}

function assertVisible(element, message) {
    totalTests++;
    // Check if style.display is 'block' or if it's not 'none' (more flexible for other display types)
    // and also check computed style for elements that might be visible by default without inline style.display
    if (element && (element.style.display === 'block' || (element.style.display !== 'none' && getComputedStyle(element).display === 'block'))) {
        passedTests++;
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message} - Element is not visible or does not exist.`);
        if(element) console.log(`Element display style: ${element.style.display}, computed: ${getComputedStyle(element).display}`); else console.log("Element not found for assertion.");
    }
}

function assertHidden(element, message) {
    totalTests++;
    if (element && (element.style.display === 'none' || getComputedStyle(element).display === 'none')) {
        passedTests++;
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message} - Element is not hidden or does not exist.`);
         if(element) console.log(`Element display style: ${element.style.display}, computed: ${getComputedStyle(element).display}`); else console.log("Element not found for assertion.");
    }
}

// Test 1: Tip Button Functionality (QR Code Display)
async function testTipButtonFunctionality() {
    console.log("\n--- Testing Tip Button (QR Code Display) Functionality ---");
    const tipButtonConfigs = [
        // Note: The first PayPal button in index.html is a duplicate and should be fixed or removed in HTML.
        // Selecting the one that correctly corresponds to the QR code image.
        // The selector `button[onclick*="displayImage('paypal'"]` might pick the first one if not more specific.
        // Let's assume the HTML structure is: button, then p, then div.image-container.
        // A more robust selector might be needed if HTML changes, e.g., by adding unique IDs to buttons.
        // For now, we rely on the order and the onclick attribute.
        // The duplicate PayPal button "Show PayPal" vs "Show PayPal QR" also needs addressing in HTML.
        // The tests will use the one that shows the QR.
        // Let's find the buttons more reliably.
        // The buttons are:
        // 1. Show PayPal (onclick="displayImage('paypal', 'paypalText')") - THIS IS A DUPLICATE and text is wrong.
        // 2. Show PayPal QR (onclick="displayImage('paypal', 'paypalText')")
        // 3. Show Bitcoin QR (onclick="displayImage('btcImage', 'btcText')")
        // 4. Show Ethereum QR (onclick="displayImage('ethImage', 'ethText')")
        // 5. Show Solana QR (onclick="displayImage('solImage', 'solText')")

        // We need to select the *correct* buttons. The `*=` selector is fine but may not be unique if text is similar.
        // The issue is the duplicate PayPal button in the provided HTML.
        // The `read_files` output for `index.html` shows:
        // <button class="tip-button" onclick="displayImage('paypal', 'paypalText')">Show PayPal</button><br>
        // <button class="tip-button" onclick="displayImage('paypal', 'paypalText')">Show PayPal QR</button><br>
        // This is problematic. The tests should ideally target unique buttons.
        // For now, I will assume the test clicks the *second* PayPal button for 'paypal' imageId.
        // This is fragile. A better fix is to give buttons unique IDs.
        // The current querySelector might pick the first one.

        // To make selectors more specific for the test, if possible:
        // Let's assume the querySelector gets the first one, which is fine if it works,
        // but the duplicate button itself is an issue in `index.html`.
        // The `script.js` `displayImage` uses the `imageId` which is unique for the container.
        // The problem is which button triggers it.

        { buttonTextContent: "Show PayPal QR", imageId: "paypal" }, // Assuming this text uniquely identifies the correct button
        { buttonTextContent: "Show Bitcoin QR", imageId: "btcImage" },
        { buttonTextContent: "Show Ethereum QR", imageId: "ethImage" },
        { buttonTextContent: "Show Solana QR", imageId: "solImage" }
    ];
    const allImageContainerIds = tipButtonConfigs.map(config => config.imageId);

    function getButtonByTextAndOnClick(text, imageId) {
        const buttons = Array.from(document.querySelectorAll('.tip-button'));
        return buttons.find(btn => btn.textContent === text && btn.getAttribute('onclick').includes(`displayImage('${imageId}'`));
    }


    // Part 1: Test individual button toggle (show/hide)
    console.log("\nPart 1: Testing individual button toggle (show/hide)...");
    for (const config of tipButtonConfigs) {
        const button = getButtonByTextAndOnClick(config.buttonTextContent, config.imageId);
        if (!button) {
            console.error(`FAIL: Tip button for image container ${config.imageId} with text "${config.buttonTextContent}" not found.`);
            totalTests++; // Count this as a failed setup
            continue;
        }

        const targetImageContainer = document.getElementById(config.imageId);
        if (!targetImageContainer) {
            console.error(`FAIL: Image container #${config.imageId} not found.`);
            totalTests++;
            continue;
        }

        console.log(`\nTesting button for: ${config.imageId}`);

        // --- First click: Show image container ---
        console.log(`Simulating first click on button for: ${config.imageId} (to show)`);
        button.click();
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for script execution

        assertVisible(targetImageContainer, `Image container #${config.imageId} should be visible after first click.`);
        allImageContainerIds.forEach(id => {
            if (id !== config.imageId) {
                const otherContainer = document.getElementById(id);
                assertHidden(otherContainer, `Other image container #${id} should be hidden when #${config.imageId} is shown.`);
            }
        });

        // --- Second click: Hide image container ---
        console.log(`Simulating second click on button for: ${config.imageId} (to hide)`);
        button.click();
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for script execution

        assertHidden(targetImageContainer, `Image container #${config.imageId} should be hidden after second click.`);
        allImageContainerIds.forEach(id => {
            // All should be hidden now, including the target one.
            const otherContainer = document.getElementById(id);
            assertHidden(otherContainer, `Other image container #${id} should also be hidden when #${config.imageId} is toggled off.`);
        });
    }

    // Part 2: Test switching between different buttons
    console.log("\nPart 2: Testing switching between different buttons...");
    if (tipButtonConfigs.length < 2) {
        console.log("Skipping switching test as less than 2 tip buttons are configured.");
    } else {
        const buttonA_config = tipButtonConfigs[0];
        const buttonB_config = tipButtonConfigs[1];

        const buttonA = getButtonByTextAndOnClick(buttonA_config.buttonTextContent, buttonA_config.imageId);
        const imageContainerA = document.getElementById(buttonA_config.imageId);

        const buttonB = getButtonByTextAndOnClick(buttonB_config.buttonTextContent, buttonB_config.imageId);
        const imageContainerB = document.getElementById(buttonB_config.imageId);

        if (!buttonA || !imageContainerA || !buttonB || !imageContainerB) {
            console.error("FAIL: Setup failed for switching test (buttons or containers not found).");
            totalTests += (buttonA && imageContainerA ? 0 : 1) + (buttonB && imageContainerB ? 0 : 1);
        } else {
            // Ensure all are hidden initially for a clean test sequence
            console.log("Resetting state: ensuring all image containers are hidden before switching test.");
            allImageContainerIds.forEach(id => {
                const container = document.getElementById(id);
                if (container.style.display !== 'none') {
                     // Try clicking its button if some state is persisted from previous test part
                     const btnConfig = tipButtonConfigs.find(c => c.imageId === id);
                     if(btnConfig) {
                        const btnToReset = getButtonByTextAndOnClick(btnConfig.buttonTextContent, btnConfig.imageId);
                        if(btnToReset && container.style.display === 'block') btnToReset.click(); // click to hide
                     }
                }
            });
            await new Promise(resolve => setTimeout(resolve, 100)); // wait for reset click

            allImageContainerIds.forEach(id => { // Verify reset
                 assertHidden(document.getElementById(id), `Container #${id} should be hidden after reset for switching test.`);
            });


            // --- Click Button A ---
            console.log(`\nSwitching Test: Clicking button for ${buttonA_config.imageId}`);
            buttonA.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            assertVisible(imageContainerA, `Image container #${buttonA_config.imageId} should be visible after clicking its button.`);
            allImageContainerIds.forEach(id => {
                if (id !== buttonA_config.imageId) {
                    assertHidden(document.getElementById(id), `Other container #${id} should be hidden when #${buttonA_config.imageId} is shown.`);
                }
            });

            // --- Click Button B ---
            console.log(`Switching Test: Clicking button for ${buttonB_config.imageId}`);
            buttonB.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            assertVisible(imageContainerB, `Image container #${buttonB_config.imageId} should be visible after clicking its button.`);
            assertHidden(imageContainerA, `Image container #${buttonA_config.imageId} should now be hidden after clicking button for #${buttonB_config.imageId}.`);
            allImageContainerIds.forEach(id => {
                if (id !== buttonB_config.imageId && id !== buttonA_config.imageId) { // buttonA already asserted hidden
                    assertHidden(document.getElementById(id), `Other container #${id} should be hidden when #${buttonB_config.imageId} is shown.`);
                }
            });

            // --- Click Button B again (to hide all) ---
            console.log(`Switching Test: Clicking button for ${buttonB_config.imageId} again to hide`);
            buttonB.click();
            await new Promise(resolve => setTimeout(resolve, 100));
            allImageContainerIds.forEach(id => {
                assertHidden(document.getElementById(id), `All containers (inc #${id}) should be hidden after toggling off #${buttonB_config.imageId}.`);
            });
        }
    }
    console.log("--- Finished Testing Tip Button (QR Code Display) Functionality ---");
}

// Test 2: Copy to Clipboard Functionality
async function testCopyToClipboardFunctionality() {
    console.log("\n--- Testing Copy to Clipboard Functionality ---");
    const copyButtons = [
        { buttonSelector: "p#btcText button.copy-button", textToCopy: "bc1qplquerydf96ejper32pr5j97d3au3kyscjz9jp" },
        { buttonSelector: "p#ethText button.copy-button", textToCopy: "0xD5E100a79C57219279A02af12623aD5B1d84F939" },
        { buttonSelector: "p#solText button.copy-button", textToCopy: "NoHmSy9pDyDph64PdjRoUeJfdEcWZyjLVuv1WSCAowJaCn" }
    ];

    // Mock navigator.clipboard.writeText if it doesn't exist (e.g. in some test environments or older browsers)
    // Or if it needs permissions that can't be granted in automated test.
    let originalClipboardWriteText = navigator.clipboard ? navigator.clipboard.writeText : null;
    if (typeof navigator.clipboard === 'undefined') {
        navigator.clipboard = {};
    }
     // For this test, we will always mock it to avoid permission issues in automated runs
     // and to reliably test the "Copied!" / "Failed!" states.
    let mockSucceeds = true; // Control this to test failure case
    navigator.clipboard.writeText = function(text) {
        return new Promise((resolve, reject) => {
            if (mockSucceeds) {
                console.log(`Mocked clipboard: Copied "${text}"`);
                resolve();
            } else {
                console.log(`Mocked clipboard: Failed to copy "${text}"`);
                reject(new Error('Mocked failure'));
            }
        });
    };


    for (const item of copyButtons) {
        const button = document.querySelector(item.buttonSelector);
        if (!button) {
            console.error(`FAIL: Copy button for "${item.textToCopy}" not found with selector "${item.buttonSelector}".`);
            totalTests++;
            continue;
        }

        const originalButtonText = button.textContent;

        // Test success case
        mockSucceeds = true;
        console.log(`Simulating successful copy for: ${item.textToCopy}`);
        button.click();
        assertEquals("Copied!", button.textContent, `Button text should change to "Copied!" for ${item.textToCopy}.`);
        await new Promise(resolve => setTimeout(resolve, 2100)); // Wait for text to revert
        assertEquals(originalButtonText, button.textContent, `Button text should revert for ${item.textToCopy} after success.`);

        // Test failure case
        mockSucceeds = false;
        console.log(`Simulating failed copy for: ${item.textToCopy}`);
        button.click();
        assertEquals("Failed!", button.textContent, `Button text should change to "Failed!" for ${item.textToCopy}.`);
        await new Promise(resolve => setTimeout(resolve, 2100)); // Wait for text to revert
        assertEquals(originalButtonText, button.textContent, `Button text should revert for ${item.textToCopy} after failure.`);
    }
    // Restore original clipboard function if it existed
    if (originalClipboardWriteText) {
        navigator.clipboard.writeText = originalClipboardWriteText;
    } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && !originalClipboardWriteText) {
        // if it was defined by us only for the mock
        delete navigator.clipboard.writeText;
        if(Object.keys(navigator.clipboard).length === 0) delete navigator.clipboard;
    }
}

// Test 3: Smooth Scrolling Functionality
function testSmoothScrollingFunctionality() {
    console.log("\n--- Testing Smooth Scrolling Functionality ---");
    console.warn("Smooth Scrolling Test: This test is a placeholder.");
    console.warn("Please manually test the following navigation links for smooth scrolling behavior:");
    const navLinks = document.querySelectorAll('nav ul li a[href^="#"], footer ul li a[href^="#"]');
    if (navLinks.length > 0) {
        navLinks.forEach(link => {
            console.warn(`- Check link: ${link.textContent} (href: ${link.getAttribute('href')})`);
        });
    } else {
        console.error("FAIL: No navigation links found for smooth scroll testing.");
        totalTests++;
    }
    // A basic check: ensure window.scrollTo is a function, as our script relies on it.
    totalTests++;
    if (typeof window.scrollTo === 'function') {
        passedTests++;
        console.log("PASS: window.scrollTo function exists.");
    } else {
        console.error("FAIL: window.scrollTo function does not exist or is not a function.");
    }
}

// Run all tests
async function runAllTests() {
    totalTests = 0;
    passedTests = 0;
    console.log("===== Starting All UI Tests =====");

    await testTipButtonFunctionality();
    await testCopyToClipboardFunctionality();
    testSmoothScrollingFunctionality(); // This one is not async

    console.log("\n===== Test Summary =====");
    console.log(`Total tests: ${totalTests}`);
    console.log(`Passed: ${passedTests}`);
    console.log(`Failed: ${totalTests - passedTests}`);
    if (totalTests === passedTests) {
        console.log("All tests passed!");
    } else {
        console.error("Some tests failed.");
    }
    console.log("==========================");
}

// Automatically run tests when the script is loaded,
// ensuring the DOM is ready (defer attribute on script tag helps with this).
// Using DOMContentLoaded for robustness.
document.addEventListener('DOMContentLoaded', function() {
    runAllTests();
});
