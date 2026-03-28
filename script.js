document.addEventListener('DOMContentLoaded', function() {
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navLinks = document.getElementById('navLinks');

  if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener('click', function() {
      const isExpanded = navLinks.classList.toggle('active');
      mobileMenuBtn.setAttribute('aria-expanded', isExpanded);
    });

    navLinks.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        navLinks.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      });
    });

    document.addEventListener('click', function(event) {
      if (!navLinks.contains(event.target) && !mobileMenuBtn.contains(event.target)) {
        navLinks.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const navLinks2 = document.querySelectorAll('a[href^="#"]');
  navLinks2.forEach(function(link) {
    link.addEventListener('click', function(event) {
      const href = this.getAttribute('href');
      if (href === '#') return;
      
      const target = document.querySelector(href);
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});

function displayImage(imageId) {
  const targetImageContainer = document.getElementById(imageId);
  if (!targetImageContainer) {
    console.error('Image container not found:', imageId);
    return;
  }

  document.querySelectorAll('.image-container').forEach(function(el) {
    el.classList.remove('show');
  });

  targetImageContainer.classList.add('show');
}

function copyToClipboard(text, buttonElement) {
  if (!navigator.clipboard) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showCopyFeedback(buttonElement, 'Copied!');
    } catch (err) {
      showCopyFeedback(buttonElement, 'Failed!');
    }
    document.body.removeChild(textarea);
    return;
  }

  navigator.clipboard.writeText(text).then(
    function() {
      showCopyFeedback(buttonElement, 'Copied!');
    },
    function(err) {
      console.error('Copy failed:', err);
      showCopyFeedback(buttonElement, 'Failed!');
    }
  );
}

function showCopyFeedback(buttonElement, message) {
  const originalText = buttonElement.innerHTML;
  buttonElement.innerHTML = getCheckIcon() + ' ' + message;
  setTimeout(function() {
    buttonElement.innerHTML = originalText;
  }, 2000);
}

function getCheckIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
}
