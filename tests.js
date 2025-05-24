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
    if (element && (element.style.display === 'block' || (element.style.display !== 'none' && getComputedStyle(element).display !== 'none'))) {
        passedTests++;
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message} - Element is not visible or does not exist.`);
        if(element) console.log(`Element display style: ${element.style.display}, computed: ${getComputedStyle(element).display}`);
    }
}

function assertHidden(element, message) {
    totalTests++;
    if (element && (element.style.display === 'none' || getComputedStyle(element).display === 'none')) {
        passedTests++;
        console.log(`PASS: ${message}`);
    } else {
        console.error(`FAIL: ${message} - Element is not hidden or does not exist.`);
         if(element) console.log(`Element display style: ${element.style.display}, computed: ${getComputedStyle(element).display}`);
    }
}

// Test 1: Tip Button Functionality
async function testTipButtonFunctionality() {
    console.log("\n--- Testing Tip Button Functionality ---");
    const tipButtons = [
        { buttonSelector: "button[onclick*=\"displayImage('paypal'\"]", imageId: "paypal", textId: "paypalText" },
        { buttonSelector: "button[onclick*=\"displayImage('btcImage'\"]", imageId: "btcImage", textId: "btcText" },
        { buttonSelector: "button[onclick*=\"displayImage('ethImage'\"]", imageId: "ethImage", textId: "ethText" },
        { buttonSelector: "button[onclick*=\"displayImage('solImage'\"]", imageId: "solImage", textId: "solText" }
    ];
    const allImageIds = ["paypal", "btcImage", "ethImage", "solImage"];

    for (const item of tipButtons) {
        const button = document.querySelector(item.buttonSelector);
        if (!button) {
            console.error(`FAIL: Tip button for ${item.imageId} not found.`);
            totalTests++; // Count this as a failed setup
            continue;
        }

        console.log(`Simulating click on button for: ${item.imageId}`);
        button.click();
        // Wait for potential script execution and style changes
        await new Promise(resolve => setTimeout(resolve, 100));


        const targetImageContainer = document.getElementById(item.imageId);
        assertVisible(targetImageContainer, `QR code container #${item.imageId} should be visible after click.`);

        allImageIds.forEach(id => {
            if (id !== item.imageId) {
                const otherImageContainer = document.getElementById(id);
                assertHidden(otherImageContainer, `Other QR code container #${id} should be hidden.`);
            }
        });
         // Also check if the text associated with the QR is visible
        const textElement = document.getElementById(item.textId);
        // The text for crypto is always visible, for paypal it's toggled by displayImage.
        if (item.imageId === 'paypal') {
             assertVisible(textElement, `Text element #${item.textId} for PayPal should be visible.`);
        } else {
            // For crypto addresses, the <p> tag is always block, so we check its existence mainly.
            // The script.js logic for displayImage also tries to set it to block.
            if (textElement) {
                 assertEquals('block', textElement.style.display, `Text element #${item.textId} for ${item.imageId} should have display:block.`);
            } else {
                console.error(`FAIL: Text element #${item.textId} for ${item.imageId} not found.`);
                totalTests++;
            }
        }


        // Click again to hide (if it's a toggle, which it is)
        button.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        assertHidden(targetImageContainer, `QR code container #${item.imageId} should be hidden after second click.`);
         if (item.imageId === 'paypal') { // Only paypal text is hidden on second click
            assertHidden(textElement, `Text element #${item.textId} for PayPal should be hidden after second click.`);
        }
    }
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
