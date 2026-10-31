var d=Object.defineProperty;var o=(a,e,r)=>e in a?d(a,e,{enumerable:!0,configurable:!0,writable:!0,value:r}):a[e]=r;var u=(a,e,r)=>o(a,typeof e!="symbol"?e+"":e,r);import{c,S as n,j as s,t}from"./createLucideIcon-D4AS73aL.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=c("ShieldCheck",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=c("X",[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]);class m extends n.Component{constructor(){super(...arguments);u(this,"state",{error:""})}static getDerivedStateFromError(r){return{error:r.message}}render(){return this.state.error?s.jsxs("section",{className:"panel",children:[s.jsxs("div",{className:"panel-head",children:[s.jsx("h2",{children:t("\u9875\u9762\u6682\u65F6\u65E0\u6CD5\u52A0\u8F7D")}),s.jsx("div",{className:"actions"})]}),s.jsxs("div",{className:"pad",children:[s.jsx("p",{children:this.props.message||t("\u65E0\u6CD5\u5B8C\u6210\u64CD\u4F5C\uFF0C\u8BF7\u5237\u65B0\u9875\u9762\u540E\u91CD\u8BD5\u3002")}),s.jsx("button",{onClick:()=>location.reload(),children:t("\u91CD\u65B0\u52A0\u8F7D")})]})]}):this.props.children}}export{m as E,h as S,p as X};
