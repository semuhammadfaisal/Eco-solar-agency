/**
 * Inventory form helpers: dynamic purchase lines, live totals, serial input
 * counting and CSV import.
 *
 * Progressive enhancement only — every form still works with JavaScript off
 * (the server validates all quantities and serial numbers again).
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

  function parseMoney(value) {
    var number = Number(String(value == null ? '' : value).replace(/[^0-9.\-]/g, ''));
    return isFinite(number) ? number : 0;
  }

  function formatNumber(value) {
    try {
      return new Intl.NumberFormat('en-PK', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(value);
    } catch (err) {
      return String(Math.round(value * 100) / 100);
    }
  }

  function serialValues(raw) {
    return String(raw || '')
      .split(/\r?\n/)
      .map(function (line) {
        var value = String(line || '').replace(/^\uFEFF/, '').trim().toUpperCase();
        if (!value) return '';
        // Drop a header row such as "Serial", "Serial No,Barcode".
        var first = value.split(',')[0].trim();
        if (/^SERIAL(\s*(NO|NUMBER|#))?$/.test(first)) return '';
        return value;
      })
      .filter(Boolean);
  }

  /* -----------------------------------------------------------------------
   * Purchase order form: add/remove lines, running totals, payment summary.
   * --------------------------------------------------------------------- */
  function initPurchaseForm(form) {
    var tbody = form.querySelector('#purchaseLines tbody');
    var template = document.getElementById('purchaseLineTemplate');
    if (!tbody || !template) return;

    var orderTotalEl = form.querySelector('[data-order-total]');
    var summaryTotalEl = form.querySelector('[data-summary-total]');
    var summaryPaidEl = form.querySelector('[data-summary-paid]');
    var summaryOutstandingEl = form.querySelector('[data-summary-outstanding]');
    var paidInput = form.querySelector('#paidAmount');

    function rows() {
      return Array.prototype.slice.call(tbody.querySelectorAll('[data-line]'));
    }

    function reindex() {
      rows().forEach(function (row, index) {
        Array.prototype.forEach.call(row.querySelectorAll('[name]'), function (field) {
          field.name = field.name.replace(/items\[\d+\]/g, 'items[' + index + ']');
        });
      });
    }

    function syncRow(row) {
      var select = row.querySelector('[data-line-item]');
      if (!select) return;
      var option = select.options[select.selectedIndex];
      var hint = row.querySelector('[data-line-hint]');
      var qty = row.querySelector('[data-line-qty]');
      var cost = row.querySelector('[data-line-cost]');

      if (!option || !option.value) {
        if (hint) hint.classList.add('d-none');
        return;
      }

      if (cost && cost.value.trim() === '') {
        var defaultCost = option.getAttribute('data-cost') || '';
        if (defaultCost) cost.value = defaultCost;
      }

      if (hint && option.getAttribute('data-serial') === '1') {
        hint.textContent = 'Serial-tracked: whole units only';
        hint.classList.remove('d-none');
        if (qty) {
          qty.step = '1';
          qty.min = '1';
        }
      } else {
        if (hint) hint.classList.add('d-none');
        if (qty) {
          qty.step = 'any';
          qty.min = '0.0001';
        }
      }
    }

    function recalc() {
      var total = 0;

      rows().forEach(function (row) {
        var qtyField = row.querySelector('[data-line-qty]');
        var costField = row.querySelector('[data-line-cost]');
        var totalField = row.querySelector('[data-line-total]');
        var qty = qtyField ? Number(qtyField.value) || 0 : 0;
        var cost = costField ? parseMoney(costField.value) : 0;
        var lineTotal = Math.round(qty * cost * 100) / 100;
        if (totalField) totalField.textContent = formatNumber(lineTotal);
        total += lineTotal;
      });

      if (orderTotalEl) orderTotalEl.textContent = formatNumber(total);
      if (summaryTotalEl) summaryTotalEl.textContent = 'PKR ' + formatNumber(total);

      var paid = paidInput ? parseMoney(paidInput.value) : 0;
      if (summaryPaidEl) summaryPaidEl.textContent = 'PKR ' + formatNumber(paid);
      if (summaryOutstandingEl) {
        summaryOutstandingEl.textContent = 'PKR ' + formatNumber(Math.max(0, total - paid));
      }
    }

    function addRow() {
      var index = rows().length;
      var html = template.innerHTML.replace(/__INDEX__/g, String(index));
      tbody.insertAdjacentHTML('beforeend', html);
      var row = rows()[rows().length - 1];
      if (row) {
        syncRow(row);
        var select = row.querySelector('[data-line-item]');
        if (select) select.focus();
      }
      reindex();
      recalc();
    }

    tbody.addEventListener('change', function (event) {
      var select = event.target.closest('[data-line-item]');
      if (!select) return;
      syncRow(select.closest('[data-line]'));
      recalc();
    });

    tbody.addEventListener('input', function (event) {
      if (
        event.target.matches('[data-line-qty]') ||
        event.target.matches('[data-line-cost]')
      ) {
        recalc();
      }
    });

    tbody.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove-line]');
      if (!remove) return;
      var row = remove.closest('[data-line]');

      if (rows().length === 1) {
        // Keep one empty line so the form still has a valid starting point.
        var select = row.querySelector('[data-line-item]');
        var qty = row.querySelector('[data-line-qty]');
        var cost = row.querySelector('[data-line-cost]');
        if (select) select.value = '';
        if (qty) qty.value = '';
        if (cost) cost.value = '';
        syncRow(row);
      } else {
        row.remove();
      }

      reindex();
      recalc();
    });

    var addButton = form.querySelector('[data-add-line]');
    if (addButton) addButton.addEventListener('click', addRow);

    if (paidInput) paidInput.addEventListener('input', recalc);

    rows().forEach(syncRow);
    reindex();
    recalc();
  }

  /* -----------------------------------------------------------------------
   * Stock transfer form: per-line cost, branch price and live profit.
   * --------------------------------------------------------------------- */
  function initTransferForm(form) {
    var tbody = form.querySelector('[data-transfer-lines]');
    var template = document.getElementById('transferLineTemplate');
    if (!tbody || !template) return;

    var totalCostEl = form.querySelector('[data-total-cost]');
    var totalBranchEl = form.querySelector('[data-total-branch]');
    var totalProfitEl = form.querySelector('[data-total-profit]');
    var totalCostLabelEl = form.querySelector('[data-total-cost-label]');
    var totalBranchLabelEl = form.querySelector('[data-total-branch-label]');
    var totalProfitLabelEl = form.querySelector('[data-total-profit-label]');

    function rows() {
      return Array.prototype.slice.call(tbody.querySelectorAll('[data-line]'));
    }

    function money(value) {
      return 'PKR ' + formatNumber(value);
    }

    function syncRow(row) {
      var select = row.querySelector('[data-line-item]');
      var option = select ? select.options[select.selectedIndex] : null;
      var available = row.querySelector('[data-line-available]');
      var price = row.querySelector('[data-line-price]');
      var costDisplay = row.querySelector('[data-line-cost-display]');

      if (!option || !option.value) {
        if (available) available.textContent = '\u2014';
        if (costDisplay) costDisplay.textContent = '\u2014';
        row.setAttribute('data-cost-paisa', '0');
        return;
      }

      var unit = option.getAttribute('data-unit') || '';
      var stock = Number(option.getAttribute('data-stock')) || 0;
      if (available) available.textContent = formatNumber(stock) + ' ' + unit;

      var costPaisa = Math.round((Number(option.getAttribute('data-cost')) || 0) * 100);
      row.setAttribute('data-cost-paisa', String(costPaisa));
      if (costDisplay) costDisplay.textContent = costPaisa > 0 ? money(costPaisa / 100) : '\u2014';

      if (price && price.value.trim() === '') {
        var defaultPrice = option.getAttribute('data-price') || '';
        if (defaultPrice) price.value = defaultPrice;
      }
    }

    function recalc() {
      var costTotal = 0;
      var branchTotal = 0;

      rows().forEach(function (row) {
        var qtyField = row.querySelector('[data-line-qty]');
        var priceField = row.querySelector('[data-line-price]');
        var profitField = row.querySelector('[data-line-profit]');
        var qty = qtyField ? Number(qtyField.value) || 0 : 0;
        var price = priceField ? parseMoney(priceField.value) : 0;
        var cost = (Number(row.getAttribute('data-cost-paisa')) || 0) / 100;
        var profit = (price - cost) * qty;

        if (profitField) {
          profitField.textContent = qty > 0 ? money(profit) : '\u2014';
          profitField.classList.toggle('text-danger', qty > 0 && profit < 0);
          profitField.classList.toggle('text-success', qty > 0 && profit > 0);
        }

        costTotal += cost * qty;
        branchTotal += price * qty;
      });

      var profitTotal = branchTotal - costTotal;

      if (totalCostEl) totalCostEl.textContent = formatNumber(costTotal);
      if (totalBranchEl) totalBranchEl.textContent = formatNumber(branchTotal);
      if (totalProfitEl) totalProfitEl.textContent = formatNumber(profitTotal);
      if (totalCostLabelEl) totalCostLabelEl.textContent = money(costTotal);
      if (totalBranchLabelEl) totalBranchLabelEl.textContent = money(branchTotal);
      if (totalProfitLabelEl) {
        totalProfitLabelEl.textContent = money(profitTotal);
        totalProfitLabelEl.classList.toggle('text-danger', profitTotal < 0);
      }
    }

    function addRow() {
      tbody.insertAdjacentHTML('beforeend', template.innerHTML);
      var row = rows()[rows().length - 1];
      if (row) {
        syncRow(row);
        var select = row.querySelector('[data-line-item]');
        if (select) select.focus();
      }
      recalc();
    }

    tbody.addEventListener('change', function (event) {
      var select = event.target.closest('[data-line-item]');
      if (!select) return;
      syncRow(select.closest('[data-line]'));
      recalc();
    });

    tbody.addEventListener('input', function (event) {
      if (event.target.matches('[data-line-qty]') || event.target.matches('[data-line-price]')) {
        recalc();
      }
    });

    tbody.addEventListener('click', function (event) {
      var remove = event.target.closest('[data-remove-line]');
      if (!remove) return;
      var row = remove.closest('[data-line]');

      if (rows().length === 1) {
        var select = row.querySelector('[data-line-item]');
        var qty = row.querySelector('[data-line-qty]');
        var price = row.querySelector('[data-line-price]');
        if (select) select.value = '';
        if (qty) qty.value = '';
        if (price) price.value = '';
        syncRow(row);
      } else {
        row.remove();
      }
      recalc();
    });

    var addButton = form.querySelector('[data-add-line]');
    if (addButton) addButton.addEventListener('click', addRow);

    rows().forEach(syncRow);
    recalc();
  }

  /* -----------------------------------------------------------------------
   * Serial textareas: live count plus first-column CSV import.
   * --------------------------------------------------------------------- */
  function updateSerialCount(textarea) {
    var key = textarea.getAttribute('data-serial-expected');
    var badge = document.querySelector('[data-serial-count-for="' + key + '"]');
    if (!badge) return;

    var count = serialValues(textarea.value).length;

    if (key === 'return') {
      var qtyField = document.querySelector('[data-return-qty]');
      var expected = qtyField ? Number(qtyField.value) || 0 : 0;
      badge.textContent = count + ' / ' + expected + ' entered';
      badge.className = 'badge border ' + (expected > 0 && count === expected
        ? 'text-bg-success-subtle text-success-emphasis border-success-subtle'
        : 'text-bg-light');
      return;
    }

    var line = textarea.closest('[data-receive-line]');
    var qty = line ? line.querySelector('[data-receive-qty]') : null;
    var expectedReceive = qty ? Number(qty.value) || 0 : 0;

    if (expectedReceive > 0) {
      badge.textContent = count + ' / ' + expectedReceive + ' entered';
      badge.className = 'badge border ' + (count === expectedReceive
        ? 'text-bg-success-subtle text-success-emphasis border-success-subtle'
        : 'text-bg-danger-subtle text-danger-emphasis border-danger-subtle');
    } else {
      badge.textContent = count + ' entered';
      badge.className = 'badge text-bg-light border';
    }
  }

  function refreshSerials() {
    document.querySelectorAll('[data-serial-input]').forEach(updateSerialCount);
  }

  function initCsvImport() {
    document.querySelectorAll('[data-serial-file]').forEach(function (input) {
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        var targetId = input.getAttribute('data-serial-target');
        var target = targetId ? document.getElementById(targetId) : null;
        if (!file || !target || !window.FileReader) return;

        var reader = new FileReader();
        reader.onload = function () {
          var values = serialValues(reader.result);
          if (values.length) {
            var existing = target.value.trim();
            target.value = (existing ? existing.replace(/\s+$/, '') + '\n' : '') + values.join('\n');
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.focus();
          }
          input.value = '';
        };
        reader.readAsText(file);
      });
    });
  }

  /* -----------------------------------------------------------------------
   * Goods receipt form.
   * --------------------------------------------------------------------- */
  function initReceiveForm(form) {
    form.addEventListener('input', function (event) {
      if (event.target.matches('[data-receive-qty]')) {
        var line = event.target.closest('[data-receive-line]');
        var textarea = line ? line.querySelector('[data-serial-input]') : null;
        if (textarea) updateSerialCount(textarea);
      }
      if (event.target.matches('[data-serial-input]')) {
        updateSerialCount(event.target);
      }
    });
  }

  /* -----------------------------------------------------------------------
   * Supplier return form: show serial box only for serialised items and
   * preview the resulting balance.
   * --------------------------------------------------------------------- */
  function initReturnForm(form) {
    var select = form.querySelector('[data-return-item]');
    var qty = form.querySelector('[data-return-qty]');
    var serialWrap = form.querySelector('[data-return-serial-wrap]');
    var preview = form.querySelector('[data-return-preview]');
    var serialInput = form.querySelector('[data-serial-input]');

    function update() {
      var option = select && select.options[select.selectedIndex];
      var isSerial = Boolean(option && option.getAttribute('data-serial') === '1');
      var stock = option ? Number(option.getAttribute('data-stock')) || 0 : 0;
      var unit = option ? option.getAttribute('data-unit') || '' : '';
      var sku = option ? option.getAttribute('data-sku') || '' : '';
      var quantity = qty ? Number(qty.value) || 0 : 0;

      if (serialWrap) serialWrap.classList.toggle('d-none', !isSerial);
      if (qty) qty.step = isSerial ? '1' : 'any';

      if (preview) {
        if (!option || !option.value) {
          preview.textContent = 'Select an item to see the resulting balance.';
        } else {
          var after = stock - quantity;
          preview.textContent = sku + ': ' + formatNumber(stock) + ' ' + unit +
            ' on hand → ' + formatNumber(after) + ' ' + unit +
            ' after this return' + (after < 0 ? ' (more than the stock on hand!)' : '.');
        }
      }

      if (serialInput) updateSerialCount(serialInput);
    }

    if (select) select.addEventListener('change', update);
    if (qty) qty.addEventListener('input', update);
    if (serialInput) serialInput.addEventListener('input', update);
    update();
  }

  /* -----------------------------------------------------------------------
   * Stock-in form: reveal serials for serialised items and preview the total.
   * --------------------------------------------------------------------- */
  function initStockInForm(form) {
    var select = form.querySelector('[data-stock-in-item]');
    var qty = form.querySelector('#qty');
    var serialBlock = form.querySelector('[data-serial-block]');
    var serialInput = form.querySelector('#serials');
    var preview = form.querySelector('[data-stock-in-preview]');
    if (!select) return;

    function update() {
      var option = select.options[select.selectedIndex];
      var selected = option && option.value;
      var hasSerial = option && option.getAttribute('data-has-serial') === '1';

      if (serialBlock) serialBlock.hidden = !hasSerial;
      if (serialInput) serialInput.required = Boolean(hasSerial);

      if (!preview) return;
      if (!selected) {
        preview.textContent = 'Select an item to see the catalogue balance after this receipt.';
        return;
      }

      var stock = Number(option.getAttribute('data-stock')) || 0;
      var unit = option.getAttribute('data-unit') || '';
      var sku = option.getAttribute('data-sku') || '';
      var added = qty ? Number(qty.value) || 0 : 0;

      preview.textContent = sku + ': ' + formatNumber(stock) + ' ' + unit +
        ' on hand, ' + formatNumber(stock + added) + ' ' + unit +
        ' after receiving ' + formatNumber(added) + '.';
    }

    select.addEventListener('change', update);
    if (qty) qty.addEventListener('input', update);
    update();
  }

  /* -----------------------------------------------------------------------
   * Serial status form: customer and project only apply while deployed.
   * --------------------------------------------------------------------- */
  function initSerialStatusForm(form) {
    var select = form.querySelector('[data-status-select]');
    var fields = form.querySelectorAll('[data-deployed-field]');
    if (!select || !fields.length) return;

    function update() {
      var deployed = select.value === 'issued' || select.value === 'installed';
      Array.prototype.forEach.call(fields, function (field) {
        field.classList.toggle('d-none', !deployed);
      });
    }

    select.addEventListener('change', update);
    update();
  }

  /* -----------------------------------------------------------------------
   * Serial registry form: stock toggle, live count and balance preview.
   * --------------------------------------------------------------------- */
  function initSerialRegisterForm(form) {
    var select = form.querySelector('[data-serial-item]');
    var toggle = form.querySelector('[data-serial-stock-toggle]');
    var stockFields = form.querySelector('[data-serial-stock-fields]');
    var serialInput = form.querySelector('#serials');
    var preview = form.querySelector('[data-serial-register-preview]');
    var hint = form.querySelector('[data-serial-item-hint]');

    function update() {
      var option = select && select.options[select.selectedIndex];
      var selected = option && option.value;
      var addToStock = Boolean(toggle && toggle.checked);

      if (stockFields) stockFields.hidden = !addToStock;

      var count = serialInput ? serialValues(serialInput.value).length : 0;
      if (serialInput) updateSerialCount(serialInput);

      if (!selected) {
        if (hint) {
          hint.textContent = 'Pick any product, whether or not it is already serial-tracked. Registering a serial marks the product as serial-tracked.';
        }
        if (preview) {
          preview.textContent = 'Select a product and enter its serials to see the stock effect.';
        }
        return;
      }

      var stock = Number(option.getAttribute('data-stock')) || 0;
      var unit = option.getAttribute('data-unit') || '';
      var sku = option.getAttribute('data-sku') || '';
      var hasSerial = option.getAttribute('data-has-serial') === '1';

      if (hint) {
        var parts = [sku + ' currently has ' + formatNumber(stock) + ' ' + unit + ' on hand.'];
        if (!hasSerial) parts.push('Registering a serial marks this product as serial-tracked.');
        if (stock <= 0 && !addToStock) {
          parts.push('Tick "Add these units to stock" to increase the balance.');
        }
        hint.textContent = parts.join(' ');
      }

      if (preview) {
        var after = addToStock ? stock + count : stock;
        preview.textContent =
          count + ' serial' + (count === 1 ? '' : 's') + ' entered. ' +
          sku + ': ' + formatNumber(stock) + ' ' + unit + ' on hand' +
          (addToStock
            ? ' → ' + formatNumber(after) + ' ' + unit + ' after this registration.'
            : ' (unchanged; stock is already recorded).');
      }
    }

    if (select) select.addEventListener('change', update);
    if (toggle) toggle.addEventListener('change', update);
    if (serialInput) serialInput.addEventListener('input', update);
    update();
  }

  /* -----------------------------------------------------------------------
   * Boot every enhancer that has a matching element on the page.
   * --------------------------------------------------------------------- */
  onReady(function () {
    var purchaseForm = document.querySelector('[data-purchase-form]');
    if (purchaseForm) initPurchaseForm(purchaseForm);

    var receiveForm = document.querySelector('[data-receive-form]');
    if (receiveForm) initReceiveForm(receiveForm);

    var returnForm = document.querySelector('[data-return-form]');
    if (returnForm) initReturnForm(returnForm);

    var stockInForm = document.querySelector('[data-stock-in-form]');
    if (stockInForm) initStockInForm(stockInForm);

    var serialRegisterForm = document.querySelector('[data-serial-register-form]');
    if (serialRegisterForm) initSerialRegisterForm(serialRegisterForm);

    var transferForm = document.querySelector('[data-transfer-form]');
    if (transferForm) initTransferForm(transferForm);

    var statusForm = document.querySelector('[data-serial-status-form]');
    if (statusForm) initSerialStatusForm(statusForm);

    initCsvImport();
    refreshSerials();
  });
})();
