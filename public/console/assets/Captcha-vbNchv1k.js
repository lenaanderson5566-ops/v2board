import{c as i,r as n,b as r,j as s}from"./ui-DEb-9bCy.js";/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const o=i("CircleCheck",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=i("ExternalLink",[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]);/**
 * @license lucide-react v0.468.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=i("Sparkles",[["path",{d:"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",key:"4pj2yx"}],["path",{d:"M20 3v4",key:"1olli1"}],["path",{d:"M22 5h-4",key:"1gvqau"}],["path",{d:"M4 17v2",key:"vumght"}],["path",{d:"M5 18H3",key:"zchphs"}]]);function y({onChange:l}){const a=n.useRef(null);return n.useEffect(()=>{if(!r.recaptchaSiteKey)return;let p=!0,t;const c=()=>{p&&a.current&&window.grecaptcha&&(t=window.grecaptcha.render(a.current,{sitekey:r.recaptchaSiteKey,callback:l,"expired-callback":()=>l("")}))};let e=document.querySelector("#recaptcha-loader");return window.grecaptcha?c():(e||(e=document.createElement("script"),e.id="recaptcha-loader",e.src="https://www.google.com/recaptcha/api.js?render=explicit",document.head.appendChild(e)),e.addEventListener("load",c)),()=>{var d;p=!1,e&&e.removeEventListener("load",c),t!==void 0&&((d=window.grecaptcha)==null||d.reset(t))}},[]),r.recaptchaSiteKey?s.jsx("div",{ref:a}):null}export{y as C,k as E,u as S,o as a};
