import{c,j as e}from"./ErrorBoundary-C0l21ZzL.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=c("CircleAlert",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const a=c("CircleCheck",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);function t({items:i,className:r=""}){return e.jsx("dl",{className:`admin-details ${r}`,children:i.map(({label:n,value:s})=>e.jsxs("div",{children:[e.jsx("dt",{children:n}),e.jsx("dd",{children:s==null||s===""?"\u2014":s})]},n))})}function m({icon:i,title:r,description:n}){return e.jsxs("div",{className:"admin-section-head",children:[e.jsx("span",{className:"admin-section-icon","aria-hidden":"true",children:i}),e.jsxs("div",{children:[e.jsx("h2",{children:r}),e.jsx("p",{children:n})]})]})}function o({notice:i}){if(!i)return null;const r=i.kind==="error"?d:a;return e.jsxs("div",{className:`admin-operation-notice ${i.kind}`,role:i.kind==="error"?"alert":"status","aria-atomic":"true",children:[e.jsx(r,{size:18,"aria-hidden":"true"}),e.jsx("span",{children:i.message})]})}export{o as A,a as C,m as a,t as b,d as c};
