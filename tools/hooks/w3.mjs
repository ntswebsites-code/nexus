/** W3 DATA_HOOKS: orders blotter reads live arrays; localStorage order stores bypassed when signed in. */
const live = (key) => `window.__mxData&&window.__mxData.${key}||`;
const liveOrders = `(window.mx&&window.mx.live&&window.mx.strict('orders'))`;
const emptyArr = `${liveOrders}?[]:`;
const emptyNull = `${liveOrders}?null:`;

export const DATA_HOOKS = {
  admin: {
    '01-inline.js': [[`let orders = [`, `let orders=window.__mxData._orders||[`]],
    'v33-rebuild.js': [[`const orders=[`, `const orders=window.__mxData._v33Orders||[`]],
    'v37-enhancements.js': [
      [
        "JSON.parse(localStorage.getItem('matanho-v37-orders')||'[]')",
        `JSON.parse(${emptyArr}localStorage.getItem('matanho-v37-orders')||'[]')`,
      ],
      [
        "localStorage.setItem('matanho-v37-orders'",
        `${liveOrders}?void 0:localStorage.setItem('matanho-v37-orders'`,
      ],
      [
        "localStorage.removeItem('matanho-v37-order-draft')",
        `${liveOrders}?void 0:localStorage.removeItem('matanho-v37-order-draft')`,
      ],
    ],
    'v44-enhancements.js': [
      [
        "localStorage.setItem('matanho-v44-order-draft'",
        `${liveOrders}?void 0:localStorage.setItem('matanho-v44-order-draft'`,
      ],
    ],
    'v53-enhancements.js': [
      [
        "JSON.parse(localStorage.getItem('matanho-v53-order-draft')||'null')",
        `JSON.parse(${emptyNull}localStorage.getItem('matanho-v53-order-draft')||'null')`,
      ],
      [
        "localStorage.setItem('matanho-v53-order-draft'",
        `${liveOrders}?void 0:localStorage.setItem('matanho-v53-order-draft'`,
      ],
      [
        "JSON.parse(localStorage.getItem('matanho-v53-submitted-orders')||'[]')",
        `JSON.parse(${emptyArr}localStorage.getItem('matanho-v53-submitted-orders')||'[]')`,
      ],
      [
        "localStorage.setItem('matanho-v53-submitted-orders'",
        `${liveOrders}?void 0:localStorage.setItem('matanho-v53-submitted-orders'`,
      ],
    ],
    'v56-enhancements.js': [
      [
        "localStorage.setItem('matanho-v56-order-draft'",
        `${liveOrders}?void 0:localStorage.setItem('matanho-v56-order-draft'`,
      ],
      [
        "JSON.parse(localStorage.getItem('matanho-v56-submitted-orders')||'[]')",
        `JSON.parse(${emptyArr}localStorage.getItem('matanho-v56-submitted-orders')||'[]')`,
      ],
      [
        "localStorage.setItem('matanho-v56-submitted-orders'",
        `${liveOrders}?void 0:localStorage.setItem('matanho-v56-submitted-orders'`,
      ],
    ],
  },
};
