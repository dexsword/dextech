function displayImage(imageId, textId) {
  const image = document.getElementById(imageId);
  const textElement = document.getElementById(textId); // Get the text element

  // Hide all image containers first
  document.querySelectorAll('.image-container').forEach(el => {
    el.style.display = 'none';
    // Also hide related text elements if they are inside .image-container or managed similarly
    // This example assumes textId elements are direct children or siblings managed along with imageId
    const associatedTextId = el.id.replace('Image', 'Text'); // Simple convention: btcImage -> btcText
     if (document.getElementById(associatedTextId) && el.id !== imageId.replace('Image', '')) { // ensure it's not the current one
        // If text is outside image-container but linked, hide it.
        // For this example, we assume text is inside image-container or managed by its display property.
     }
  });

  // Toggle display for the clicked image and its text
  if (image.style.display === 'none') {
    image.style.display = 'block';
    if (textElement) { // Check if textElement exists
        textElement.style.display = 'block'; // Ensure text is visible
    }
  } else {
    image.style.display = 'none';
    if (textElement) { // Check if textElement exists
        textElement.style.display = 'none'; // Hide text if image is hidden
    }
  }
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
