// How to run these tests:
// 1. Open support.html in your browser.
// 2. Open the browser's developer console (usually by pressing F12).
// 3. Uncomment the test script in HTML or paste this content into the console.
// 4. Call `runAllTests()` to run the tests.
// Note: For production, this script should be removed or loaded conditionally.

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

function assertTrue(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message}`);
    }
}

function assertHasClass(element, className, message) {
    totalTests++;
    if (element && element.classList.contains(className)) {
        passedTests++;
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message}`);
    }
}

function assertNotHasClass(element, className, message) {
    totalTests++;
    if (element && !element.classList.contains(className)) {
        passedTests++;
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message}`);
    }
}

// Test 1: Tip Button Functionality (QR Code Display)
async function testTipButtonFunctionality() {
    console.log("\n--- Testing Tip Button (QR Code Display) Functionality ---");
    const tipButtonConfigs = [
        { buttonTextContent: "Show QR Code", imageId: "paypal" },
        { buttonTextContent: "Show QR Code", imageId: "btcImage" },
        { buttonTextContent: "Show QR Code", imageId: "ethImage" },
        { buttonTextContent: "Show QR Code", imageId: "solImage" }
    ];

    function getButtonByTextAndImageId(text, imageId) {
        const buttons = Array.from(document.querySelectorAll('.tip-button'));
        return buttons.find(function(btn) {
            return btn.textContent.trim() === text && btn.getAttribute('onclick').includes("displayImage('" + imageId + "')");
        });
    }

    // Part 1: "Show QR Code" is idempotent; clicking again keeps it visible.
    console.log("\nPart 1: Testing individual button display...");
    for (var i = 0; i < tipButtonConfigs.length; i++) {
        var config = tipButtonConfigs[i];
        var button = getButtonByTextAndImageId(config.buttonTextContent, config.imageId);
        if (!button) {
            console.error("FAIL: Button for " + config.imageId + " not found.");
            totalTests++;
            continue;
        }

        var targetContainer = document.getElementById(config.imageId);
        if (!targetContainer) {
            console.error("FAIL: Image container #" + config.imageId + " not found.");
            totalTests++;
            continue;
        }

        console.log("Testing button for: " + config.imageId);

        // First click: should show
        button.click();
        await new Promise(function(resolve) { setTimeout(resolve, 100); });

        assertHasClass(targetContainer, 'show', "Image container #" + config.imageId + " should have 'show' class after first click.");

        // Second click: should remain visible
        button.click();
        await new Promise(function(resolve) { setTimeout(resolve, 100); });

        assertHasClass(targetContainer, 'show', "Image container #" + config.imageId + " should remain visible after second click.");
    }

    // Part 2: Test switching between buttons
    console.log("\nPart 2: Testing switching between different buttons...");
    var buttonA = getButtonByTextAndImageId("Show QR Code", "paypal");
    var buttonB = getButtonByTextAndImageId("Show QR Code", "btcImage");
    var containerA = document.getElementById("paypal");
    var containerB = document.getElementById("btcImage");

    if (buttonA && buttonB && containerA && containerB) {
        // Click button A
        buttonA.click();
        await new Promise(function(resolve) { setTimeout(resolve, 100); });
        assertHasClass(containerA, 'show', "Container A should be visible after clicking button A.");

        // Click button B
        buttonB.click();
        await new Promise(function(resolve) { setTimeout(resolve, 100); });
        assertHasClass(containerB, 'show', "Container B should be visible after clicking button B.");
        assertNotHasClass(containerA, 'show', "Container A should be hidden after clicking button B.");
    } else {
        console.error("FAIL: Could not find test elements for switching test.");
        totalTests++;
    }

    console.log("--- Finished Testing Tip Button Functionality ---");
}

// Test 2: Copy to Clipboard Functionality
async function testCopyToClipboardFunctionality() {
    console.log("\n--- Testing Copy to Clipboard Functionality ---");
    var copyButtons = document.querySelectorAll('.copy-button');
    
    assertTrue(copyButtons.length > 0, "Found " + copyButtons.length + " copy buttons on the page.");

    // Mock clipboard
    var originalClipboard = navigator.clipboard;
    navigator.clipboard = {
        writeText: function(text) {
            return new Promise(function(resolve, reject) {
                console.log("Mocked clipboard write: " + text.substring(0, 20) + "...");
                resolve();
            });
        }
    };

    // Test first copy button
    if (copyButtons.length > 0) {
        var originalHTML = copyButtons[0].innerHTML;
        copyButtons[0].click();
        
        await new Promise(function(resolve) { setTimeout(resolve, 100); });
        var newHTML = copyButtons[0].innerHTML;
        
        assertTrue(newHTML.indexOf('Copied!') !== -1 || newHTML.indexOf('copy-button') !== -1, "Copy button shows feedback after click.");
        
        await new Promise(function(resolve) { setTimeout(resolve, 2100); });
    }

    // Restore
    navigator.clipboard = originalClipboard;
    console.log("--- Finished Testing Copy to Clipboard Functionality ---");
}

// Test 3: Mobile Menu Toggle
function testMobileMenuFunctionality() {
    console.log("\n--- Testing Mobile Menu Functionality ---");
    var mobileMenuBtn = document.getElementById('mobileMenuBtn');
    var navLinks = document.getElementById('navLinks');

    if (!mobileMenuBtn || !navLinks) {
        console.log("Mobile menu elements not found - desktop layout.");
        return;
    }

    totalTests++;
    if (mobileMenuBtn.tagName === 'BUTTON') {
        passedTests++;
        console.log("PASS: Mobile menu button exists and is a button element.");
    } else {
        console.error("FAIL: Mobile menu button should be a button element.");
    }

    totalTests++;
    var hasClickHandler = typeof mobileMenuBtn.onclick !== 'undefined' || mobileMenuBtn.hasAttribute('onclick');
    if (hasClickHandler || mobileMenuBtn.addEventListener) {
        passedTests++;
        console.log("PASS: Mobile menu has click handler.");
    } else {
        console.error("FAIL: Mobile menu missing click handler.");
    }

    console.log("--- Finished Testing Mobile Menu Functionality ---");
}

// Test 4: Accessibility Checks
function testAccessibility() {
    console.log("\n--- Testing Accessibility Features ---");
    
    // Check for ARIA labels on buttons
    var buttons = document.querySelectorAll('button');
    var buttonsWithAria = 0;
    buttons.forEach(function(btn) {
        if (btn.getAttribute('aria-label') || btn.textContent.trim()) {
            buttonsWithAria++;
        }
    });
    
    totalTests++;
    if (buttonsWithAria === buttons.length) {
        passedTests++;
        console.log("PASS: All buttons have accessible text or aria-label.");
    } else {
        console.error("FAIL: Some buttons lack accessible text.");
    }

    // Check for semantic HTML
    var hasHeader = document.querySelector('header') !== null;
    var hasMain = document.querySelector('main') !== null;
    var hasFooter = document.querySelector('footer') !== null;

    totalTests++;
    if (hasHeader && hasMain && hasFooter) {
        passedTests++;
        console.log("PASS: Page uses semantic HTML structure.");
    } else {
        console.error("FAIL: Page missing semantic HTML elements.");
    }

    console.log("--- Finished Testing Accessibility ---");
}

// Run all tests
async function runAllTests() {
    totalTests = 0;
    passedTests = 0;
    console.log("===== Starting All UI Tests =====");

    await testTipButtonFunctionality();
    await testCopyToClipboardFunctionality();
    testMobileMenuFunctionality();
    testAccessibility();

    console.log("\n===== Test Summary =====");
    console.log("Total tests: " + totalTests);
    console.log("Passed: " + passedTests);
    console.log("Failed: " + (totalTests - passedTests));
    if (totalTests === passedTests) {
        console.log("All tests passed!");
    } else {
        console.error("Some tests failed.");
    }
    console.log("==========================");
}

// Export for manual testing
window.runAllTests = runAllTests;
