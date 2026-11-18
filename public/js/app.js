/**
 * Client-side helpers. No framework — Alpine handles interactive form state.
 * Bootstrap bundle and Alpine are loaded by the layouts before this file.
 */
(function () {
  'use strict';

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    /* ---------------------------------------------------------------------
     * Immediate navigation feedback. It makes ordinary server-rendered page
     * changes feel responsive while the next request is being processed.
     * ------------------------------------------------------------------- */
    function showPageLoader() {
      document.body.classList.add('is-navigating');
      document.body.setAttribute('aria-busy', 'true');
    }

    function hidePageLoader() {
      document.body.classList.remove('is-navigating');
      document.body.removeAttribute('aria-busy');
    }

    window.addEventListener('pageshow', hidePageLoader);

    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var link = event.target.closest('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download') || link.hasAttribute('data-bs-toggle')) return;

      var href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0 || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;

      try {
        var destination = new URL(link.href, window.location.href);
        if (destination.origin !== window.location.origin) return;
        if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
        showPageLoader();
      } catch (err) {
        /* malformed URL — let the browser handle it normally */
      }
    });

    document.addEventListener('submit', function (event) {
      window.requestAnimationFrame(function () {
        if (!event.defaultPrevented) showPageLoader();
      });
    });

    /* ---------------------------------------------------------------------
     * Timed notices: set the delay in milliseconds with data-auto-dismiss.
     * ------------------------------------------------------------------- */
    document.querySelectorAll('[data-auto-dismiss]').forEach(function (noticeEl) {
      var delay = Number.parseInt(noticeEl.getAttribute('data-auto-dismiss'), 10) || 5000;

      window.setTimeout(function () {
        noticeEl.style.transition = 'opacity 220ms ease, transform 220ms ease';
        noticeEl.style.opacity = '0';
        noticeEl.style.transform = 'translateY(-4px)';

        window.setTimeout(function () {
          noticeEl.remove();
        }, 220);
      }, delay);
    });

    /* ---------------------------------------------------------------------
     * Auto-dismiss flash messages after 7 seconds (keep them until hovered).
     * ------------------------------------------------------------------- */
    document.querySelectorAll('.app-alert.alert-dismissible').forEach(function (alertEl) {
      var timeout = window.setTimeout(function () {
        if (window.bootstrap && window.bootstrap.Alert) {
          window.bootstrap.Alert.getOrCreateInstance(alertEl).close();
        }
      }, 7000);

      alertEl.addEventListener('mouseenter', function () {
        window.clearTimeout(timeout);
      });
    });

    /* ---------------------------------------------------------------------
     * Shared delete confirmation modal.
     * Buttons opt in with data-delete-url and data-delete-name.
     * ------------------------------------------------------------------- */
    var modalEl = document.getElementById('confirmDeleteModal');
    var deleteForm = document.getElementById('confirmDeleteForm');
    var targetLabel = modalEl ? modalEl.querySelector('[data-delete-target]') : null;

    if (modalEl && deleteForm && window.bootstrap) {
      document.addEventListener('click', function (event) {
        var trigger = event.target.closest('[data-delete-url]');
        if (!trigger) return;

        event.preventDefault();
        deleteForm.setAttribute('action', trigger.getAttribute('data-delete-url'));

        if (targetLabel) {
          targetLabel.textContent = trigger.getAttribute('data-delete-name') || 'this record';
        }

        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
      });
    }

    /* ---------------------------------------------------------------------
     * Desktop sidebar collapse (remembered in localStorage).
     * ------------------------------------------------------------------- */
    var sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', function () {
        document.body.classList.toggle('sidebar-collapsed');
        try {
          window.localStorage.setItem(
            'sidebarCollapsed',
            document.body.classList.contains('sidebar-collapsed') ? '1' : '0'
          );
        } catch (err) {
          /* private mode — ignore */
        }
      });
    }

    /* ---------------------------------------------------------------------
     * Keep long sidebar menus at the same position between page loads.
     * ------------------------------------------------------------------- */
    var sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav) {
      var savedSidebarScroll = 0;

      try {
        savedSidebarScroll = Number.parseInt(
          window.sessionStorage.getItem('sidebarScrollTop') || '0',
          10
        );
      } catch (err) {
        /* storage disabled — active-link fallback below still works */
      }

      if (savedSidebarScroll > 0) {
        sidebarNav.scrollTop = savedSidebarScroll;
      } else {
        var activeSidebarLink = sidebarNav.querySelector('.nav-link.active');
        if (activeSidebarLink) {
          activeSidebarLink.scrollIntoView({ block: 'nearest' });
        }
      }

      var sidebarScrollFrame = null;
      sidebarNav.addEventListener('scroll', function () {
        if (sidebarScrollFrame !== null) return;

        sidebarScrollFrame = window.requestAnimationFrame(function () {
          try {
            window.sessionStorage.setItem('sidebarScrollTop', String(sidebarNav.scrollTop));
          } catch (err) {
            /* storage disabled — ignore */
          }
          sidebarScrollFrame = null;
        });
      }, { passive: true });

      // Bootstrap's responsive offcanvas can otherwise pass wheel input to
      // the document. Route wheel movement over the sidebar to its menu.
      var sidebarSurface = sidebarNav.closest('.sidebar-surface');
      if (sidebarSurface) {
        sidebarSurface.addEventListener('wheel', function (event) {
          if (event.ctrlKey) return;

          var multiplier = 1;
          if (event.deltaMode === 1) multiplier = 16;
          if (event.deltaMode === 2) multiplier = sidebarNav.clientHeight;

          sidebarNav.scrollTop += event.deltaY * multiplier;
          sidebarNav.scrollLeft += event.deltaX * multiplier;
          event.preventDefault();
        }, { passive: false });
      }
    }

    /* ---------------------------------------------------------------------
     * Optional date pickers: <input data-flatpickr>
     * The library is loaded per page via pageScripts when needed.
     * ------------------------------------------------------------------- */
    if (window.flatpickr) {
      document.querySelectorAll('[data-flatpickr]').forEach(function (input) {
        window.flatpickr(input, {
          dateFormat: input.getAttribute('data-date-format') || 'Y-m-d',
          allowInput: true,
          disableMobile: true,
        });
      });
    }

    /* ---------------------------------------------------------------------
     * Optional client-side DataTables: <table data-datatable>
     * Server-side pagination is the default for list screens.
     * ------------------------------------------------------------------- */
    if (window.jQuery && window.jQuery.fn && window.jQuery.fn.DataTable) {
      window.jQuery('table[data-datatable]').each(function () {
        window.jQuery(this).DataTable({
          pageLength: 10,
          order: [],
          language: { search: '', searchPlaceholder: 'Search…' },
        });
      });
    }

    /* ---------------------------------------------------------------------
     * Prevent double submits on forms that opt in with data-once.
     * ------------------------------------------------------------------- */
    document.querySelectorAll('form[data-once]').forEach(function (form) {
      form.addEventListener('submit', function () {
        var button = form.querySelector('button[type="submit"]');
        if (button) {
          button.dataset.originalText = button.innerHTML;
          button.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Working…';
          button.disabled = true;
          button.classList.add('disabled');
        }
      });
    });
  });
})();
