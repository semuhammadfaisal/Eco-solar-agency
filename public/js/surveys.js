(function () {
  'use strict';
  function ready(fn) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function () {
    var form = document.querySelector('[data-survey-form]');
    if (!form) return;
    var inputs = Array.prototype.slice.call(form.querySelectorAll('[data-monthly-units]'));
    var average = form.querySelector('[data-average-units]');
    var suggestion = form.querySelector('[data-sizing-suggestion]');
    var recommended = form.querySelector('[data-recommended-kw]');
    function calculate() {
      var values = inputs.map(function (input) { return Number(input.value); }).filter(function (value) { return isFinite(value) && value > 0; });
      var avg = values.length ? values.reduce(function (sum, value) { return sum + value; }, 0) / values.length : 0;
      if (average) average.textContent = 'Average: ' + Math.round(avg * 10) / 10 + ' units';
      if (!suggestion || !avg) { if (suggestion) suggestion.textContent = 'Enter monthly units for a suggestion.'; return; }
      var production = Number(suggestion.getAttribute('data-production')) || 120;
      var buffer = Number(suggestion.getAttribute('data-buffer')) || 0;
      var step = Number(suggestion.getAttribute('data-step')) || 0.5;
      var kw = Math.ceil(((avg / production) * (1 + buffer / 100)) / step) * step;
      kw = Math.round(kw * 100) / 100;
      suggestion.textContent = 'Suggested: ' + kw + ' kW from ' + Math.round(avg * 10) / 10 + ' average units.';
      if (recommended && !recommended.value) recommended.placeholder = String(kw);
    }
    inputs.forEach(function (input) { input.addEventListener('input', calculate); });
    calculate();
  });
})();
