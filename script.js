document.addEventListener('DOMContentLoaded', function() {
  var revealElements = document.querySelectorAll('.service-card, .trust-item, .tip-item');
  revealElements.forEach(function(el) {
    el.classList.add('reveal');
  });

  var revealObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  revealElements.forEach(function(el) {
    revealObserver.observe(el);
  });

  var mobileMenuBtn = document.getElementById('mobileMenuBtn');
  var navLinks = document.getElementById('navLinks');

  if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener('click', function() {
      var isExpanded = navLinks.classList.toggle('active');
      mobileMenuBtn.setAttribute('aria-expanded', isExpanded);
      document.body.style.overflow = isExpanded ? 'hidden' : '';
    });

    mobileMenuBtn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        mobileMenuBtn.click();
      }
    });

    navLinks.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        navLinks.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    document.addEventListener('click', function(event) {
      if (!navLinks.contains(event.target) && !mobileMenuBtn.contains(event.target)) {
        navLinks.classList.remove('active');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  var navLinks2 = document.querySelectorAll('a[href^="#"]');
  navLinks2.forEach(function(link) {
    link.addEventListener('click', function(event) {
      var href = this.getAttribute('href');
      if (href === '#') return;
      
      var target = document.querySelector(href);
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  initBookingWidget();
});

function initBookingWidget() {
  var bookingWidget = document.getElementById('bookingWidget');
  if (!bookingWidget) {
    console.log('Booking widget not found');
    return;
  }
  
  console.log('Booking widget initialized');

  var selectedDate = null;
  var selectedTime = null;
  var availability = {};
  var pendingStripeUrl = null;

  var step1 = document.getElementById('step1');
  var step2 = document.getElementById('step2');
  var step3 = document.getElementById('step3');
  var step4 = document.getElementById('step4');
  var calendarDays = document.getElementById('calendarDays');
  var currentWeekSpan = document.getElementById('currentWeek');
  var timeSlots = document.getElementById('timeSlots');
  var bookingForm = document.getElementById('bookingForm');
  var bookingError = document.getElementById('bookingError');

  function getWeekStart(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  var currentWeek = getWeekStart(new Date());

  fetchAvailability();

  // "Book & Pay" service card buttons: scroll to widget, pre-select service, store Stripe URL
  document.querySelectorAll('.service-buy-btn[data-stripe]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      var service = this.getAttribute('data-service');
      var stripe = this.getAttribute('data-stripe');
      resetBooking();
      pendingStripeUrl = stripe;
      document.getElementById('bookingService').value = service;
      var widget = document.getElementById('bookingWidget');
      if (widget) widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.getElementById('prevWeek').addEventListener('click', function() {
    currentWeek.setDate(currentWeek.getDate() - 7);
    renderCalendar();
  });

  document.getElementById('nextWeek').addEventListener('click', function() {
    currentWeek.setDate(currentWeek.getDate() + 7);
    renderCalendar();
  });

  document.getElementById('backToDate').addEventListener('click', function() {
    showStep(1);
  });

  document.getElementById('backToTime').addEventListener('click', function() {
    showStep(2);
  });

  document.getElementById('bookAnother').addEventListener('click', function() {
    resetBooking();
  });

  bookingForm.addEventListener('submit', function(e) {
    e.preventDefault();
    submitBooking();
  });

  function fetchAvailability() {
    console.log('Fetching availability...');
    fetch('/api/availability')
      .then(function(res) { 
        console.log('Availability response:', res.status);
        return res.json(); 
      })
      .then(function(data) {
        console.log('Availability data:', data);
        availability = data;
        renderCalendar();
      })
      .catch(function(err) {
        console.error('Error fetching availability:', err);
        renderCalendarFallback();
      });
  }

  function renderCalendarFallback() {
    renderCalendar();
  }

  function renderCalendar() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 35);

    var weekEnd = new Date(currentWeek);
    weekEnd.setDate(currentWeek.getDate() + 6);

    var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var label = weekEnd.getMonth() === currentWeek.getMonth()
      ? monthNames[currentWeek.getMonth()] + ' ' + currentWeek.getDate() + ' – ' + weekEnd.getDate() + ', ' + weekEnd.getFullYear()
      : monthNames[currentWeek.getMonth()] + ' ' + currentWeek.getDate() + ' – ' + monthNames[weekEnd.getMonth()] + ' ' + weekEnd.getDate() + ', ' + weekEnd.getFullYear();
    currentWeekSpan.textContent = label;

    var dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var html = '';

    for (var i = 0; i < 7; i++) {
      var date = new Date(currentWeek);
      date.setDate(currentWeek.getDate() + i);
      var dateStr = formatDate(date);
      var isPast = date < today;
      var isSunday = date.getDay() === 0;
      var isBeyond = date > maxDate;
      var hasSlots = availability[dateStr] && availability[dateStr].length > 0;
      var disabled = isPast || isSunday || isBeyond;
      var classes = 'calendar-day' + (disabled ? ' disabled' : '') + (hasSlots && !disabled ? ' has-slots' : '') + (selectedDate === dateStr ? ' selected' : '');

      html += '<div class="' + classes + '" data-date="' + dateStr + '"' + (!disabled ? ' tabindex="0"' : '') + '>';
      html += '<span class="cal-day-name">' + dayNames[date.getDay()] + '</span>';
      html += '<span class="cal-day-num">' + date.getDate() + '</span>';
      html += '</div>';
    }

    calendarDays.innerHTML = html;

    calendarDays.querySelectorAll('.calendar-day:not(.disabled)').forEach(function(el) {
      el.addEventListener('click', function() { selectDate(this.getAttribute('data-date')); });
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectDate(this.getAttribute('data-date')); }
      });
    });

    var todayWeek = getWeekStart(today);
    document.getElementById('prevWeek').disabled = currentWeek <= todayWeek;
    document.getElementById('nextWeek').disabled = currentWeek >= getWeekStart(maxDate);
  }

  function selectDate(dateStr) {
    selectedDate = dateStr;
    selectedTime = null;
    renderCalendar();
    loadTimeSlots(dateStr);
    showStep(2);
  }

  function loadTimeSlots(dateStr) {
    timeSlots.innerHTML = '<div class="booking-loading"><div class="spinner"></div></div>';
    
    fetch('/api/availability/' + dateStr)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        renderTimeSlots(data.available);
      })
      .catch(function(err) {
        console.error('Error loading time slots:', err);
        timeSlots.innerHTML = '<p style="text-align: center; color: #666;">Error loading times</p>';
      });
  }

  function renderTimeSlots(slots) {
    if (!slots || slots.length === 0) {
      timeSlots.innerHTML = '<p style="text-align: center; color: #666; grid-column: 1/-1;">No available times on this date</p>';
      return;
    }
    
    var html = '';
    slots.forEach(function(hour) {
      var timeStr = formatTime(hour);
      var selected = selectedTime === hour ? ' selected' : '';
      html += '<button type="button" class="time-slot' + selected + '" data-hour="' + hour + '">' + timeStr + '</button>';
    });
    
    timeSlots.innerHTML = html;
    
    timeSlots.querySelectorAll('.time-slot').forEach(function(btn) {
      btn.addEventListener('click', function() {
        selectTime(parseInt(this.getAttribute('data-hour')));
      });
    });
  }

  function selectTime(hour) {
    selectedTime = hour;
    renderTimeSlots(availability[selectedDate] || []);
    showStep(3);
  }

  function showStep(step) {
    step1.classList.remove('active');
    step2.classList.remove('active');
    step3.classList.remove('active');
    step4.classList.remove('active');
    
    if (step === 1) step1.classList.add('active');
    if (step === 2) step2.classList.add('active');
    if (step === 3) step3.classList.add('active');
    if (step === 4) step4.classList.add('active');
  }

  function validateForm(name, email, phone, service) {
    var emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var phoneRe = /^[\d\s\-()+.]{7,20}$/;
    if (!name || name.trim().length < 2) return 'Please enter your full name.';
    if (!email || !emailRe.test(email.trim())) return 'Please enter a valid email address.';
    if (!phone || !phoneRe.test(phone.trim())) return 'Please enter a valid phone number.';
    if (!service) return 'Please select a service.';
    if (!selectedDate) return 'Please select a date.';
    if (selectedTime === null || selectedTime === undefined) return 'Please select a time slot.';
    return null;
  }

  function submitBooking() {
    var name = document.getElementById('bookingName').value;
    var email = document.getElementById('bookingEmail').value;
    var phone = document.getElementById('bookingPhone').value;
    var service = document.getElementById('bookingService').value;
    var notes = document.getElementById('bookingNotes').value;

    bookingError.style.display = 'none';

    var validationError = validateForm(name, email, phone, service);
    if (validationError) {
      bookingError.textContent = validationError;
      bookingError.style.display = 'block';
      return;
    }

    var submitBtn = bookingForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Booking…';

    fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        email: email,
        phone: phone,
        date: selectedDate,
        hour: selectedTime,
        service: service,
        notes: notes
      })
    })
    .then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Booking failed. Please try again.');
        return data;
      });
    })
    .then(function(data) {
      showConfirmation(name, email, selectedDate, selectedTime, service, data.bookingId);
      fetchAvailability();
      showStep(4);
    })
    .catch(function(err) {
      bookingError.textContent = err.message;
      bookingError.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Book Appointment';
    });
  }

  function showConfirmation(name, email, date, time, service, bookingId) {
    var details = document.getElementById('confirmationDetails');
    var formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    function setText(label, value) {
      var p = document.createElement('p');
      var strong = document.createElement('strong');
      strong.textContent = label + ': ';
      p.appendChild(strong);
      p.appendChild(document.createTextNode(value));
      return p;
    }

    details.innerHTML = '';
    details.appendChild(setText('Name', name));
    details.appendChild(setText('Email', email));
    details.appendChild(setText('Date', formattedDate));
    details.appendChild(setText('Time', formatTime(time)));
    details.appendChild(setText('Service', service));
    if (bookingId) details.appendChild(setText('Booking ID', bookingId));

    var paymentAction = document.getElementById('paymentAction');
    var stripePayBtn = document.getElementById('stripePayBtn');
    if (pendingStripeUrl && paymentAction && stripePayBtn) {
      stripePayBtn.href = pendingStripeUrl;
      paymentAction.style.display = 'block';
    } else if (paymentAction) {
      paymentAction.style.display = 'none';
    }
  }

  function resetBooking() {
    selectedDate = null;
    selectedTime = null;
    pendingStripeUrl = null;
    currentWeek = getWeekStart(new Date());
    bookingForm.reset();
    bookingError.style.display = 'none';
    var submitBtn = bookingForm.querySelector('button[type="submit"]');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Book Appointment';
    var paymentAction = document.getElementById('paymentAction');
    if (paymentAction) paymentAction.style.display = 'none';
    fetchAvailability();
    showStep(1);
  }

  function formatDate(date) {
    var year = date.getFullYear();
    var month = ('0' + (date.getMonth() + 1)).slice(-2);
    var day = ('0' + date.getDate()).slice(-2);
    return year + '-' + month + '-' + day;
  }

  function formatTime(hour) {
    var suffix = hour >= 12 ? 'PM' : 'AM';
    var displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return displayHour + ':00 ' + suffix;
  }
}

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
