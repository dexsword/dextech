function displayImage(imageId, textId) {
  // Get the target image container element
  const targetImageContainer = document.getElementById(imageId);

  if (!targetImageContainer) {
    console.error(`Image container with ID "${imageId}" not found.`);
    return;
  }

  // Determine if the target image container is currently visible
  // Use getComputedStyle for a more robust check, though style.display should work if set directly.
  const isCurrentlyVisible = targetImageContainer.style.display === 'block';

  // Hide ALL image containers first
  document.querySelectorAll('.image-container').forEach(el => {
    el.style.display = 'none';
  });

  // If the target image container was NOT visible before we hid everything, then show it.
  // This creates the toggle effect: if it was hidden, show it. If it was shown, it's now hidden by the loop above.
  if (!isCurrentlyVisible) {
    targetImageContainer.style.display = 'block';
  }

  // The textId parameter and textElement logic have been removed
  // as the associated text paragraphs (e.g., p#paypalText, p#btcText)
  // are styled with "display: block;" inline in index.html,
  // meaning they are intended to be always visible and not toggled by this function.
}

function copyToClipboard(text, buttonElement) {
  navigator.clipboard.writeText(text).then(function() {
    const originalText = buttonElement.textContent;
    buttonElement.textContent = 'Copied!';
    setTimeout(function() {
      buttonElement.textContent = originalText;
    }, 2000); // Change back after 2 seconds
  }, function(err) {
    console.error('Could not copy text: ', err);
    // Optionally, provide feedback for error
    const originalText = buttonElement.textContent;
    buttonElement.textContent = 'Failed!';
    setTimeout(function() {
      buttonElement.textContent = originalText;
    }, 2000);
  });
}

// Smooth scrolling for navigation links
document.addEventListener('DOMContentLoaded', function() {
  // Select all navigation links in the header and footer
  // This targets links within <nav> elements and also footer links for broader coverage
  const navLinks = document.querySelectorAll('nav ul li a[href^="#"], footer ul li a[href^="#"]');

  navLinks.forEach(link => {
    link.addEventListener('click', function(event) {
      // Prevent the default anchor link behavior (jumping directly to the section)
      event.preventDefault();

      // Get the target section's ID from the href attribute
      const targetId = this.getAttribute('href');

      // Find the target element using the ID
      // Handles cases where href might be just "#" or an invalid ID
      let targetElement;
      try {
        targetElement = document.querySelector(targetId);
      } catch (e) {
        console.error('Invalid selector for smooth scroll:', targetId, e);
        return; // Exit if the selector is invalid (e.g., href="#")
      }


      if (targetElement) {
        // Calculate the position of the target element
        const targetPosition = targetElement.offsetTop;

        // Scroll smoothly to the target element
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      } else {
        console.warn('Smooth scroll target not found for ID:', targetId);
      }
    });
  });
});
