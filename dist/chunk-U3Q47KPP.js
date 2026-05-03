var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/emoji-regex/index.js
var require_emoji_regex = __commonJS({
  "node_modules/emoji-regex/index.js"(exports, module) {
    "use strict";
    module.exports = function() {
      return /\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62(?:\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67|\uDB40\uDC73\uDB40\uDC63\uDB40\uDC74|\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73)\uDB40\uDC7F|\uD83D\uDC68(?:\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68\uD83C\uDFFB|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFE])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D)?\uD83D\uDC68|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D[\uDC68\uDC69])\u200D(?:\uD83D[\uDC66\uDC67])|[\u2695\u2696\u2708]\uFE0F|\uD83D[\uDC66\uDC67]|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|(?:\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708])\uFE0F|\uD83C\uDFFB\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C[\uDFFB-\uDFFF])|(?:\uD83E\uDDD1\uD83C\uDFFB\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)\uD83C\uDFFB|\uD83E\uDDD1(?:\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])|\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1)|(?:\uD83E\uDDD1\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFF\u200D\uD83E\uDD1D\u200D(?:\uD83D[\uDC68\uDC69]))(?:\uD83C[\uDFFB-\uDFFE])|(?:\uD83E\uDDD1\uD83C\uDFFC\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)(?:\uD83C[\uDFFB\uDFFC])|\uD83D\uDC69(?:\uD83C\uDFFE\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB-\uDFFD\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFC\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFD-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFB\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFC-\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFD\u200D(?:\uD83E\uDD1D\u200D\uD83D\uDC68(?:\uD83C[\uDFFB\uDFFC\uDFFE\uDFFF])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\u200D(?:\u2764\uFE0F\u200D(?:\uD83D\uDC8B\u200D(?:\uD83D[\uDC68\uDC69])|\uD83D[\uDC68\uDC69])|\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD])|\uD83C\uDFFF\u200D(?:\uD83C[\uDF3E\uDF73\uDF93\uDFA4\uDFA8\uDFEB\uDFED]|\uD83D[\uDCBB\uDCBC\uDD27\uDD2C\uDE80\uDE92]|\uD83E[\uDDAF-\uDDB3\uDDBC\uDDBD]))|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67]))|(?:\uD83E\uDDD1\uD83C\uDFFD\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1|\uD83D\uDC69\uD83C\uDFFE\u200D\uD83E\uDD1D\u200D\uD83D\uDC69)(?:\uD83C[\uDFFB-\uDFFD])|\uD83D\uDC69\u200D\uD83D\uDC66\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC69\u200D(?:\uD83D[\uDC66\uDC67])|(?:\uD83D\uDC41\uFE0F\u200D\uD83D\uDDE8|\uD83D\uDC69(?:\uD83C\uDFFF\u200D[\u2695\u2696\u2708]|\uD83C\uDFFE\u200D[\u2695\u2696\u2708]|\uD83C\uDFFC\u200D[\u2695\u2696\u2708]|\uD83C\uDFFB\u200D[\u2695\u2696\u2708]|\uD83C\uDFFD\u200D[\u2695\u2696\u2708]|\u200D[\u2695\u2696\u2708])|(?:(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)\uFE0F|\uD83D\uDC6F|\uD83E[\uDD3C\uDDDE\uDDDF])\u200D[\u2640\u2642]|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD6-\uDDDD])(?:(?:\uD83C[\uDFFB-\uDFFF])\u200D[\u2640\u2642]|\u200D[\u2640\u2642])|\uD83C\uDFF4\u200D\u2620)\uFE0F|\uD83D\uDC69\u200D\uD83D\uDC67\u200D(?:\uD83D[\uDC66\uDC67])|\uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08|\uD83D\uDC15\u200D\uD83E\uDDBA|\uD83D\uDC69\u200D\uD83D\uDC66|\uD83D\uDC69\u200D\uD83D\uDC67|\uD83C\uDDFD\uD83C\uDDF0|\uD83C\uDDF4\uD83C\uDDF2|\uD83C\uDDF6\uD83C\uDDE6|[#\*0-9]\uFE0F\u20E3|\uD83C\uDDE7(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEF\uDDF1-\uDDF4\uDDF6-\uDDF9\uDDFB\uDDFC\uDDFE\uDDFF])|\uD83C\uDDF9(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDED\uDDEF-\uDDF4\uDDF7\uDDF9\uDDFB\uDDFC\uDDFF])|\uD83C\uDDEA(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDED\uDDF7-\uDDFA])|\uD83E\uDDD1(?:\uD83C[\uDFFB-\uDFFF])|\uD83C\uDDF7(?:\uD83C[\uDDEA\uDDF4\uDDF8\uDDFA\uDDFC])|\uD83D\uDC69(?:\uD83C[\uDFFB-\uDFFF])|\uD83C\uDDF2(?:\uD83C[\uDDE6\uDDE8-\uDDED\uDDF0-\uDDFF])|\uD83C\uDDE6(?:\uD83C[\uDDE8-\uDDEC\uDDEE\uDDF1\uDDF2\uDDF4\uDDF6-\uDDFA\uDDFC\uDDFD\uDDFF])|\uD83C\uDDF0(?:\uD83C[\uDDEA\uDDEC-\uDDEE\uDDF2\uDDF3\uDDF5\uDDF7\uDDFC\uDDFE\uDDFF])|\uD83C\uDDED(?:\uD83C[\uDDF0\uDDF2\uDDF3\uDDF7\uDDF9\uDDFA])|\uD83C\uDDE9(?:\uD83C[\uDDEA\uDDEC\uDDEF\uDDF0\uDDF2\uDDF4\uDDFF])|\uD83C\uDDFE(?:\uD83C[\uDDEA\uDDF9])|\uD83C\uDDEC(?:\uD83C[\uDDE6\uDDE7\uDDE9-\uDDEE\uDDF1-\uDDF3\uDDF5-\uDDFA\uDDFC\uDDFE])|\uD83C\uDDF8(?:\uD83C[\uDDE6-\uDDEA\uDDEC-\uDDF4\uDDF7-\uDDF9\uDDFB\uDDFD-\uDDFF])|\uD83C\uDDEB(?:\uD83C[\uDDEE-\uDDF0\uDDF2\uDDF4\uDDF7])|\uD83C\uDDF5(?:\uD83C[\uDDE6\uDDEA-\uDDED\uDDF0-\uDDF3\uDDF7-\uDDF9\uDDFC\uDDFE])|\uD83C\uDDFB(?:\uD83C[\uDDE6\uDDE8\uDDEA\uDDEC\uDDEE\uDDF3\uDDFA])|\uD83C\uDDF3(?:\uD83C[\uDDE6\uDDE8\uDDEA-\uDDEC\uDDEE\uDDF1\uDDF4\uDDF5\uDDF7\uDDFA\uDDFF])|\uD83C\uDDE8(?:\uD83C[\uDDE6\uDDE8\uDDE9\uDDEB-\uDDEE\uDDF0-\uDDF5\uDDF7\uDDFA-\uDDFF])|\uD83C\uDDF1(?:\uD83C[\uDDE6-\uDDE8\uDDEE\uDDF0\uDDF7-\uDDFB\uDDFE])|\uD83C\uDDFF(?:\uD83C[\uDDE6\uDDF2\uDDFC])|\uD83C\uDDFC(?:\uD83C[\uDDEB\uDDF8])|\uD83C\uDDFA(?:\uD83C[\uDDE6\uDDEC\uDDF2\uDDF3\uDDF8\uDDFE\uDDFF])|\uD83C\uDDEE(?:\uD83C[\uDDE8-\uDDEA\uDDF1-\uDDF4\uDDF6-\uDDF9])|\uD83C\uDDEF(?:\uD83C[\uDDEA\uDDF2\uDDF4\uDDF5])|(?:\uD83C[\uDFC3\uDFC4\uDFCA]|\uD83D[\uDC6E\uDC71\uDC73\uDC77\uDC81\uDC82\uDC86\uDC87\uDE45-\uDE47\uDE4B\uDE4D\uDE4E\uDEA3\uDEB4-\uDEB6]|\uD83E[\uDD26\uDD37-\uDD39\uDD3D\uDD3E\uDDB8\uDDB9\uDDCD-\uDDCF\uDDD6-\uDDDD])(?:\uD83C[\uDFFB-\uDFFF])|(?:\u26F9|\uD83C[\uDFCB\uDFCC]|\uD83D\uDD75)(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u261D\u270A-\u270D]|\uD83C[\uDF85\uDFC2\uDFC7]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66\uDC67\uDC6B-\uDC6D\uDC70\uDC72\uDC74-\uDC76\uDC78\uDC7C\uDC83\uDC85\uDCAA\uDD74\uDD7A\uDD90\uDD95\uDD96\uDE4C\uDE4F\uDEC0\uDECC]|\uD83E[\uDD0F\uDD18-\uDD1C\uDD1E\uDD1F\uDD30-\uDD36\uDDB5\uDDB6\uDDBB\uDDD2-\uDDD5])(?:\uD83C[\uDFFB-\uDFFF])|(?:[\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55]|\uD83C[\uDC04\uDCCF\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE1A\uDE2F\uDE32-\uDE36\uDE38-\uDE3A\uDE50\uDE51\uDF00-\uDF20\uDF2D-\uDF35\uDF37-\uDF7C\uDF7E-\uDF93\uDFA0-\uDFCA\uDFCF-\uDFD3\uDFE0-\uDFF0\uDFF4\uDFF8-\uDFFF]|\uD83D[\uDC00-\uDC3E\uDC40\uDC42-\uDCFC\uDCFF-\uDD3D\uDD4B-\uDD4E\uDD50-\uDD67\uDD7A\uDD95\uDD96\uDDA4\uDDFB-\uDE4F\uDE80-\uDEC5\uDECC\uDED0-\uDED2\uDED5\uDEEB\uDEEC\uDEF4-\uDEFA\uDFE0-\uDFEB]|\uD83E[\uDD0D-\uDD3A\uDD3C-\uDD45\uDD47-\uDD71\uDD73-\uDD76\uDD7A-\uDDA2\uDDA5-\uDDAA\uDDAE-\uDDCA\uDDCD-\uDDFF\uDE70-\uDE73\uDE78-\uDE7A\uDE80-\uDE82\uDE90-\uDE95])|(?:[#\*0-9\xA9\xAE\u203C\u2049\u2122\u2139\u2194-\u2199\u21A9\u21AA\u231A\u231B\u2328\u23CF\u23E9-\u23F3\u23F8-\u23FA\u24C2\u25AA\u25AB\u25B6\u25C0\u25FB-\u25FE\u2600-\u2604\u260E\u2611\u2614\u2615\u2618\u261D\u2620\u2622\u2623\u2626\u262A\u262E\u262F\u2638-\u263A\u2640\u2642\u2648-\u2653\u265F\u2660\u2663\u2665\u2666\u2668\u267B\u267E\u267F\u2692-\u2697\u2699\u269B\u269C\u26A0\u26A1\u26AA\u26AB\u26B0\u26B1\u26BD\u26BE\u26C4\u26C5\u26C8\u26CE\u26CF\u26D1\u26D3\u26D4\u26E9\u26EA\u26F0-\u26F5\u26F7-\u26FA\u26FD\u2702\u2705\u2708-\u270D\u270F\u2712\u2714\u2716\u271D\u2721\u2728\u2733\u2734\u2744\u2747\u274C\u274E\u2753-\u2755\u2757\u2763\u2764\u2795-\u2797\u27A1\u27B0\u27BF\u2934\u2935\u2B05-\u2B07\u2B1B\u2B1C\u2B50\u2B55\u3030\u303D\u3297\u3299]|\uD83C[\uDC04\uDCCF\uDD70\uDD71\uDD7E\uDD7F\uDD8E\uDD91-\uDD9A\uDDE6-\uDDFF\uDE01\uDE02\uDE1A\uDE2F\uDE32-\uDE3A\uDE50\uDE51\uDF00-\uDF21\uDF24-\uDF93\uDF96\uDF97\uDF99-\uDF9B\uDF9E-\uDFF0\uDFF3-\uDFF5\uDFF7-\uDFFF]|\uD83D[\uDC00-\uDCFD\uDCFF-\uDD3D\uDD49-\uDD4E\uDD50-\uDD67\uDD6F\uDD70\uDD73-\uDD7A\uDD87\uDD8A-\uDD8D\uDD90\uDD95\uDD96\uDDA4\uDDA5\uDDA8\uDDB1\uDDB2\uDDBC\uDDC2-\uDDC4\uDDD1-\uDDD3\uDDDC-\uDDDE\uDDE1\uDDE3\uDDE8\uDDEF\uDDF3\uDDFA-\uDE4F\uDE80-\uDEC5\uDECB-\uDED2\uDED5\uDEE0-\uDEE5\uDEE9\uDEEB\uDEEC\uDEF0\uDEF3-\uDEFA\uDFE0-\uDFEB]|\uD83E[\uDD0D-\uDD3A\uDD3C-\uDD45\uDD47-\uDD71\uDD73-\uDD76\uDD7A-\uDDA2\uDDA5-\uDDAA\uDDAE-\uDDCA\uDDCD-\uDDFF\uDE70-\uDE73\uDE78-\uDE7A\uDE80-\uDE82\uDE90-\uDE95])\uFE0F|(?:[\u261D\u26F9\u270A-\u270D]|\uD83C[\uDF85\uDFC2-\uDFC4\uDFC7\uDFCA-\uDFCC]|\uD83D[\uDC42\uDC43\uDC46-\uDC50\uDC66-\uDC78\uDC7C\uDC81-\uDC83\uDC85-\uDC87\uDC8F\uDC91\uDCAA\uDD74\uDD75\uDD7A\uDD90\uDD95\uDD96\uDE45-\uDE47\uDE4B-\uDE4F\uDEA3\uDEB4-\uDEB6\uDEC0\uDECC]|\uD83E[\uDD0F\uDD18-\uDD1F\uDD26\uDD30-\uDD39\uDD3C-\uDD3E\uDDB5\uDDB6\uDDB8\uDDB9\uDDBB\uDDCD-\uDDCF\uDDD1-\uDDDD])/g;
    };
  }
});

// node_modules/ansi-regex/index.js
var require_ansi_regex = __commonJS({
  "node_modules/ansi-regex/index.js"(exports, module) {
    "use strict";
    module.exports = ({ onlyFirst = false } = {}) => {
      const pattern = [
        "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
        "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))"
      ].join("|");
      return new RegExp(pattern, onlyFirst ? void 0 : "g");
    };
  }
});

// node_modules/strip-ansi/index.js
var require_strip_ansi = __commonJS({
  "node_modules/strip-ansi/index.js"(exports, module) {
    "use strict";
    var ansiRegex = require_ansi_regex();
    module.exports = (string) => typeof string === "string" ? string.replace(ansiRegex(), "") : string;
  }
});

// src/queryDemo.ts
import OpenAI from "openai";
import fs from "fs/promises";
import path3 from "path";
import { homedir as homedir4 } from "os";

// src/utils/logger.ts
import { readdir, readFile, stat, mkdir, writeFile } from "fs/promises";
import { join as join2 } from "path";

// src/utils/logPaths.ts
import { homedir } from "os";
import { join } from "path";
var EFREX_DIR = join(homedir(), ".efrex");
var LOG_PATHS = {
  logs: () => join(EFREX_DIR, "logs"),
  errors: () => join(EFREX_DIR, "errors"),
  debug: () => join(EFREX_DIR, "debug")
};
function dateToFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

// src/bootstrap/state.ts
var STATE = {
  cwd: "",
  originalCwd: "",
  projectRoot: "",
  lastAPIRequest: null,
  lastAPIRequestMessages: null
};
function getCwdState() {
  return STATE.cwd;
}
function setCwdState(cwd) {
  STATE.cwd = cwd.normalize("NFC");
}
function getOriginalCwd() {
  return STATE.originalCwd;
}
function setOriginalCwd(cwd) {
  STATE.originalCwd = cwd.normalize("NFC");
}
function setProjectRoot(cwd) {
  STATE.projectRoot = cwd.normalize("NFC");
}
function setLastAPIRequest(params) {
  STATE.lastAPIRequest = params;
}
function setLastAPIRequestMessages(messages) {
  STATE.lastAPIRequestMessages = messages;
}

// src/utils/logger.ts
var MAX_IN_MEMORY_ERRORS = 100;
var inMemoryErrorLog = [];
function addToInMemoryErrorLog(errorInfo) {
  if (inMemoryErrorLog.length >= MAX_IN_MEMORY_ERRORS) {
    inMemoryErrorLog.shift();
  }
  inMemoryErrorLog.push(errorInfo);
}
var errorQueue = [];
var errorLogSink = null;
function attachErrorLogSink(newSink) {
  if (errorLogSink !== null) return;
  errorLogSink = newSink;
  if (errorQueue.length > 0) {
    const queued = [...errorQueue];
    errorQueue.length = 0;
    for (const event of queued) {
      errorLogSink.logError(event.error);
    }
  }
}
function toError(error) {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error(String(error));
}
function logError(error) {
  const err = toError(error);
  try {
    const errorStr = err.stack || err.message;
    const errorInfo = {
      error: errorStr,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    addToInMemoryErrorLog(errorInfo);
    if (errorLogSink === null) {
      errorQueue.push({ type: "error", error: err });
      return;
    }
    errorLogSink.logError(err);
  } catch {
  }
}
function captureAPIRequest(params, opts) {
  const { messages, ...paramsWithoutMessages } = params;
  setLastAPIRequest(paramsWithoutMessages);
  if (opts?.includeMessages && opts.messages) {
    setLastAPIRequestMessages(opts.messages);
  } else {
    setLastAPIRequestMessages(null);
  }
}
function createFileErrorSink() {
  const errorsPath = LOG_PATHS.errors();
  return {
    getErrorsPath: () => errorsPath,
    logError: async (error) => {
      try {
        await mkdir(errorsPath, { recursive: true });
        const filename = `${dateToFilename(/* @__PURE__ */ new Date())}.json`;
        const filepath = join2(errorsPath, filename);
        const payload = {
          error: error.stack || error.message,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        await writeFile(filepath, JSON.stringify(payload, null, 2) + "\n", { flag: "a" });
      } catch {
      }
    }
  };
}

// src/tools/GlobTool/GlobTool.ts
import { z } from "zod/v4";

// src/utils/lazySchema.ts
function lazySchema(factory) {
  let cached;
  return () => cached ??= factory();
}

// src/tools/GlobTool/prompt.ts
var DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`;

// src/utils/path.ts
import { homedir as homedir2 } from "os";
import { isAbsolute, join as join4, normalize, relative, resolve as resolve2 } from "path";

// src/utils/platform.ts
import { readdir as readdir2, readFile as readFile2 } from "fs/promises";
import { release as osRelease } from "os";
import memoize from "lodash.memoize";
import { readFileSync } from "fs";
var getPlatform = memoize(() => {
  try {
    if (process.platform === "darwin") {
      return "macos";
    }
    if (process.platform === "win32") {
      return "windows";
    }
    if (process.platform === "linux") {
      try {
        const procVersion = readFileSync(
          "/proc/version",
          { encoding: "utf8" }
        );
        if (procVersion.toLowerCase().includes("microsoft") || procVersion.toLowerCase().includes("wsl")) {
          return "wsl";
        }
      } catch (error) {
        logError(error);
      }
      return "linux";
    }
    return "unknown";
  } catch (error) {
    logError(error);
    return "unknown";
  }
});
var getWslVersion = memoize(() => {
  if (process.platform !== "linux") {
    return void 0;
  }
  try {
    const procVersion = readFileSync("/proc/version", {
      encoding: "utf8"
    });
    const wslVersionMatch = procVersion.match(/WSL(\d+)/i);
    if (wslVersionMatch && wslVersionMatch[1]) {
      return wslVersionMatch[1];
    }
    if (procVersion.toLowerCase().includes("microsoft")) {
      return "1";
    }
    return void 0;
  } catch (error) {
    logError(error);
    return void 0;
  }
});
var getLinuxDistroInfo = memoize(
  async () => {
    if (process.platform !== "linux") {
      return void 0;
    }
    const result = {
      linuxKernel: osRelease()
    };
    try {
      const content = await readFile2("/etc/os-release", "utf8");
      for (const line of content.split("\n")) {
        const match = line.match(/^(ID|VERSION_ID)=(.*)$/);
        if (match && match[1] && match[2]) {
          const value = match[2].replace(/^"|"$/g, "");
          if (match[1] === "ID") {
            result.linuxDistroId = value;
          } else {
            result.linuxDistroVersion = value;
          }
        }
      }
    } catch {
    }
    return result;
  }
);

// src/utils/cwd.ts
import { AsyncLocalStorage } from "async_hooks";
import { cwd as getProcessCwd } from "process";
var cwdOverrideStorage = new AsyncLocalStorage();
function pwd() {
  const override = cwdOverrideStorage.getStore();
  if (override) return override;
  return getCwdState() || getOriginalCwd() || getProcessCwd();
}
function getCwd() {
  try {
    return pwd();
  } catch {
    return getOriginalCwd();
  }
}

// src/utils/windowsPaths.ts
import memoize2 from "lodash.memoize";
import * as path from "path";
import * as pathWin32 from "path/win32";

// src/utils/execSyncWrapper.ts
import {
  execSync as nodeExecSync
} from "child_process";
function execSync_DEPRECATED(command, options) {
  return nodeExecSync(command, options);
}

// src/utils/windowsPaths.ts
function checkPathExists(path4) {
  try {
    execSync_DEPRECATED(`dir "${path4}"`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function findExecutable(executable) {
  if (executable === "git") {
    const defaultLocations = [
      // check 64 bit before 32 bit
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files (x86)\\Git\\cmd\\git.exe"
      // intentionally don't look for C:\Program Files\Git\mingw64\bin\git.exe
      // because that directory is the "raw" tools with no environment setup
    ];
    for (const location of defaultLocations) {
      if (checkPathExists(location)) {
        return location;
      }
    }
  }
  try {
    const result = execSync_DEPRECATED(`where.exe ${executable}`, {
      stdio: "pipe",
      encoding: "utf8"
    }).trim();
    const paths = result.split("\r\n").filter(Boolean);
    const cwd = getCwd().toLowerCase();
    for (const candidatePath of paths) {
      const normalizedPath = path.resolve(candidatePath).toLowerCase();
      const pathDir = path.dirname(normalizedPath).toLowerCase();
      if (pathDir === cwd || normalizedPath.startsWith(cwd + path.sep)) {
        continue;
      }
      return candidatePath;
    }
    return null;
  } catch {
    return null;
  }
}
var findGitBashPath = memoize2(() => {
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    if (checkPathExists(process.env.CLAUDE_CODE_GIT_BASH_PATH)) {
      return process.env.CLAUDE_CODE_GIT_BASH_PATH;
    }
    console.error(
      `Claude Code was unable to find CLAUDE_CODE_GIT_BASH_PATH path "${process.env.CLAUDE_CODE_GIT_BASH_PATH}"`
    );
    process.exit(1);
  }
  const gitPath = findExecutable("git");
  if (gitPath) {
    const bashPath = pathWin32.join(gitPath, "..", "..", "bin", "bash.exe");
    if (checkPathExists(bashPath)) {
      return bashPath;
    }
  }
  console.error(
    "Claude Code on Windows requires git-bash (https://git-scm.com/downloads/win). If installed but not in PATH, set environment variable pointing to your bash.exe, similar to: CLAUDE_CODE_GIT_BASH_PATH=C:\\Program Files\\Git\\bin\\bash.exe"
  );
  process.exit(1);
});
var posixPathToWindowsPath = (posixPath) => {
  if (posixPath.startsWith("//")) {
    return posixPath.replace(/\//g, "\\");
  }
  const cygdriveMatch = posixPath.match(/^\/cygdrive\/([A-Za-z])(\/|$)/);
  if (cygdriveMatch) {
    const driveLetter = cygdriveMatch[1].toUpperCase();
    const rest = posixPath.slice(("/cygdrive/" + cygdriveMatch[1]).length);
    return driveLetter + ":" + (rest || "\\").replace(/\//g, "\\");
  }
  const driveMatch = posixPath.match(/^\/([A-Za-z])(\/|$)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toUpperCase();
    const rest = posixPath.slice(2);
    return driveLetter + ":" + (rest || "\\").replace(/\//g, "\\");
  }
  return posixPath.replace(/\//g, "\\");
};

// src/utils/path.ts
function toRelativePath(absolutePath) {
  const relativePath = relative(getCwd(), absolutePath);
  return relativePath.startsWith("..") ? absolutePath : relativePath;
}
function expandPath(path4, baseDir) {
  const actualBaseDir = baseDir ?? getCwd() ?? process.cwd();
  if (typeof path4 !== "string") {
    throw new TypeError(`Path must be a string, received ${typeof path4}`);
  }
  if (typeof actualBaseDir !== "string") {
    throw new TypeError(
      `Base directory must be a string, received ${typeof actualBaseDir}`
    );
  }
  if (path4.includes("\0") || actualBaseDir.includes("\0")) {
    throw new Error("Path contains null bytes");
  }
  const trimmedPath = path4.trim();
  if (!trimmedPath) {
    return normalize(actualBaseDir).normalize("NFC");
  }
  if (trimmedPath === "~") {
    return homedir2().normalize("NFC");
  }
  if (trimmedPath.startsWith("~/")) {
    return join4(homedir2(), trimmedPath.slice(2)).normalize("NFC");
  }
  let processedPath = trimmedPath;
  if (getPlatform() === "windows" && trimmedPath.match(/^\/[a-z]\//i)) {
    try {
      processedPath = posixPathToWindowsPath(trimmedPath);
    } catch {
      processedPath = trimmedPath;
    }
  }
  if (isAbsolute(processedPath)) {
    return normalize(processedPath).normalize("NFC");
  }
  return resolve2(actualBaseDir, processedPath).normalize("NFC");
}

// src/Tool.ts
function buildTool(def) {
  return {
    ...def
  };
}

// src/utils/glob.ts
import { isAbsolute as isAbsolute2, join as join6 } from "path";

// src/utils/ripgrep.ts
import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import memoize3 from "lodash.memoize";
import { homedir as homedir3 } from "os";
import * as path2 from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.join(__filename, "../");
function isEnvDefinedFalsy(value) {
  if (!value) return false;
  return ["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}
function countCharInString(str, char) {
  let count = 0;
  for (const c of str) {
    if (c === char) count++;
  }
  return count;
}
var getRipgerepConfig = memoize3(() => {
  const userWantsSystem = isEnvDefinedFalsy(process.env.USE_BUILTIN_RIPGREP);
  if (userWantsSystem) {
    return { mode: "system", command: "rg", args: [] };
  }
  const rgRoot = path2.resolve(__dirname, "vendor", "ripgrep");
  const builtinPath = process.platform === "win32" ? path2.resolve(rgRoot, `${process.arch}-win32`, "rg.exe") : path2.resolve(rgRoot, `${process.arch}-${process.platform}`, "rg");
  if (!existsSync(builtinPath)) {
    return { mode: "system", command: "rg", args: [] };
  }
  return { mode: "builtin", command: builtinPath, args: [] };
});
function ripgrepCommand() {
  const config = getRipgerepConfig();
  return {
    rgPath: config.command,
    rgArgs: config.args
  };
}
var MAX_BUFFER_SIZE = 2e7;
var RipgrepTimeoutError = class extends Error {
  constructor(message, partialResults) {
    super(message);
    this.partialResults = partialResults;
    this.name = "RipgrepTimeoutError";
  }
  partialResults;
};
function ripGrepRaw(args, target, abortSignal, callback) {
  const { rgPath, rgArgs } = ripgrepCommand();
  const fullArgs = [...rgArgs, ...args, target];
  const defaultTimeout = getPlatform() === "wsl" ? 6e4 : 2e4;
  const parsedSeconds = parseInt(process.env.CLAUDE_CODE_GLOB_TIMEOUT_SECONDS || "", 10) || 0;
  const timeout = parsedSeconds > 0 ? parsedSeconds * 1e3 : defaultTimeout;
  const child = spawn(rgPath, fullArgs, {
    signal: abortSignal,
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  child.stdout?.on("data", (data) => {
    if (!stdoutTruncated) {
      stdout += data.toString();
      if (stdout.length > MAX_BUFFER_SIZE) {
        stdout = stdout.slice(0, MAX_BUFFER_SIZE);
        stdoutTruncated = true;
      }
    }
  });
  child.stderr?.on("data", (data) => {
    if (!stderrTruncated) {
      stderr += data.toString();
      if (stderr.length > MAX_BUFFER_SIZE) {
        stderr = stderr.slice(0, MAX_BUFFER_SIZE);
        stderrTruncated = true;
      }
    }
  });
  let killTimeoutId;
  const timeoutId = setTimeout(() => {
    if (process.platform === "win32") {
      child.kill();
    } else {
      child.kill("SIGTERM");
      killTimeoutId = setTimeout((c) => c.kill("SIGKILL"), 5e3, child);
    }
  }, timeout);
  let settled = false;
  child.on("close", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    clearTimeout(killTimeoutId);
    if (code === 0 || code === 1) {
      callback(null, stdout, stderr);
    } else {
      const error = new Error(
        `ripgrep exited with code ${code}`
      );
      error.code = code ?? void 0;
      error.signal = signal ?? void 0;
      callback(error, stdout, stderr);
    }
  });
  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    clearTimeout(killTimeoutId);
    const error = err;
    callback(error, stdout, stderr);
  });
  return child;
}
async function ripGrep(args, target, abortSignal) {
  return new Promise((resolve4, reject) => {
    const handleResult = (error, stdout, stderr) => {
      if (!error) {
        resolve4(
          //表示成功
          stdout.trim().split("\n").map((line) => line.replace(/\r$/, "")).filter(Boolean)
          //删除空字符串，null，undefined
        );
        return;
      }
      if (error.code === 1) {
        resolve4([]);
        return;
      }
      const CRITICAL_ERROR_CODES = ["ENOENT", "EACCES", "EPERM"];
      if (CRITICAL_ERROR_CODES.includes(error.code)) {
        reject(error);
        return;
      }
      const hasOutput = stdout && stdout.trim().length > 0;
      const isTimeout = error.signal === "SIGTERM" || error.signal === "SIGKILL" || error.code === "ABORT_ERR";
      const isBufferOverflow = error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      let lines = [];
      if (hasOutput) {
        lines = stdout.trim().split("\n").map((line) => line.replace(/\r$/, "")).filter(Boolean);
        if (lines.length > 0 && (isTimeout || isBufferOverflow)) {
          lines = lines.slice(0, -1);
        }
      }
      if (isTimeout && lines.length === 0) {
        reject(
          new RipgrepTimeoutError(
            `Ripgrep search timed out after ${getPlatform() === "wsl" ? 60 : 20} seconds.`,
            lines
          )
        );
        return;
      }
      resolve4(lines);
    };
    ripGrepRaw(args, target, abortSignal, (error, stdout, stderr) => {
      handleResult(error, stdout, stderr);
    });
  });
}
async function ripGrepFileCount(args, target, abortSignal) {
  const { rgPath, rgArgs } = ripgrepCommand();
  return new Promise((resolve4, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      signal: abortSignal,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let lines = 0;
    child.stdout?.on("data", (chunk) => {
      lines += countCharInString(chunk.toString(), "\n");
    });
    let settled = false;
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0 || code === 1) resolve4(lines);
      else reject(new Error(`rg --files exited ${code}`));
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}
var countFilesRoundedRg = memoize3(
  async (dirPath, abortSignal, ignorePatterns = []) => {
    if (path2.resolve(dirPath) === path2.resolve(homedir3())) {
      return void 0;
    }
    try {
      const args = ["--files", "--hidden"];
      ignorePatterns.forEach((pattern) => {
        args.push("--glob", `!${pattern}`);
      });
      const count = await ripGrepFileCount(args, dirPath, abortSignal);
      if (count === 0) return 0;
      const magnitude = Math.floor(Math.log10(count));
      const power = Math.pow(10, magnitude);
      return Math.round(count / power) * power;
    } catch {
    }
  },
  (dirPath, _abortSignal, ignorePatterns = []) => `${dirPath}|${ignorePatterns.join(",")}`
);

// src/utils/glob.ts
function extractGlobBaseDirectory(pattern) {
  const match = pattern.match(/[*?[{}]/);
  if (!match || match.index === void 0) {
    return { baseDir: "", relativePattern: pattern };
  }
  const prefix = pattern.slice(0, match.index);
  const lastSep = Math.max(
    prefix.lastIndexOf("/"),
    prefix.lastIndexOf("\\")
  );
  if (lastSep === -1) {
    return { baseDir: "", relativePattern: pattern };
  }
  return {
    baseDir: prefix.slice(0, lastSep),
    relativePattern: pattern.slice(lastSep + 1)
  };
}
async function glob(filePattern, cwd, { limit, offset }, abortSignal) {
  let searchDir = cwd;
  let searchPattern = filePattern;
  if (isAbsolute2(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern);
    if (baseDir) {
      searchDir = baseDir;
      searchPattern = relativePattern;
    }
  }
  const args = ["--files", "--glob", searchPattern, "--sort=modified"];
  const allPaths = await ripGrep(args, searchDir, abortSignal);
  const absolutePaths = allPaths.map(
    (p) => isAbsolute2(p) ? p : join6(searchDir, p)
  );
  const truncated = absolutePaths.length > offset + limit;
  const files = absolutePaths.slice(offset, offset + limit);
  return { files, truncated };
}

// src/tools/GlobTool/GlobTool.ts
var inputSchema = lazySchema(
  () => z.strictObject({
    pattern: z.string().describe("The glob pattern to match files against"),
    path: z.string().optional().describe(
      'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.'
    )
  })
);
var outputSchema = lazySchema(
  () => z.object({
    durationMs: z.number().describe("Time taken to execute the search in milliseconds"),
    numFiles: z.number().describe("Total number of files found"),
    filenames: z.array(z.string()).describe("Array of file paths that match the pattern"),
    truncated: z.boolean().describe("Whether results were truncated (limited to 100 files)")
  })
);
var GlobTool = buildTool({
  name: "glob",
  searchHint: "find files by name pattern or wildcard",
  maxResultSizeChars: 1e5,
  async description() {
    return DESCRIPTION;
  },
  userFacingName() {
    return "Find";
  },
  get inputSchema() {
    return inputSchema();
  },
  get outputSchema() {
    return outputSchema();
  },
  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  async call(input, context) {
    const start = Date.now();
    const searchPath = input.path ? expandPath(input.path) : getCwd();
    const limit = context.globLimits?.maxResults ?? 100;
    const { files, truncated } = await glob(
      input.pattern,
      searchPath,
      { limit, offset: 0 },
      context.abortController.signal
    );
    const filenames = files.map(toRelativePath);
    return {
      type: "success",
      data: {
        filenames,
        durationMs: Date.now() - start,
        numFiles: filenames.length,
        truncated
      }
    };
  }
});

// src/tools/GrepTool/GrepTool.ts
import { z as z4 } from "zod/v4";

// src/utils/semanticBoolean.ts
import { z as z2 } from "zod/v4";
function semanticBoolean(inner = z2.boolean()) {
  return z2.preprocess(
    (v) => v === "true" ? true : v === "false" ? false : v,
    inner
  );
}

// src/tools/GrepTool/GrepTool.ts
import { stat as stat2 } from "fs/promises";

// src/utils/semanticNumber.ts
import { z as z3 } from "zod/v4";
function semanticNumber(inner = z3.number()) {
  return z3.preprocess((v) => {
    if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return v;
  }, inner);
}

// src/tools/GrepTool/prompt.ts
var GREP_TOOL_NAME = "Grep";
function getDescription() {
  return `A powerful search tool built on ripgrep

`;
}

// src/utils/intl.ts
var graphemeSegmenter;
function getGraphemeSegmenter() {
  if (!graphemeSegmenter) {
    graphemeSegmenter = new Intl.Segmenter(void 0, {
      granularity: "grapheme"
    });
  }
  return graphemeSegmenter;
}

// src/ink/stringWidth.ts
var import_emoji_regex = __toESM(require_emoji_regex(), 1);

// node_modules/get-east-asian-width/lookup-data.js
var ambiguousRanges = [161, 161, 164, 164, 167, 168, 170, 170, 173, 174, 176, 180, 182, 186, 188, 191, 198, 198, 208, 208, 215, 216, 222, 225, 230, 230, 232, 234, 236, 237, 240, 240, 242, 243, 247, 250, 252, 252, 254, 254, 257, 257, 273, 273, 275, 275, 283, 283, 294, 295, 299, 299, 305, 307, 312, 312, 319, 322, 324, 324, 328, 331, 333, 333, 338, 339, 358, 359, 363, 363, 462, 462, 464, 464, 466, 466, 468, 468, 470, 470, 472, 472, 474, 474, 476, 476, 593, 593, 609, 609, 708, 708, 711, 711, 713, 715, 717, 717, 720, 720, 728, 731, 733, 733, 735, 735, 768, 879, 913, 929, 931, 937, 945, 961, 963, 969, 1025, 1025, 1040, 1103, 1105, 1105, 8208, 8208, 8211, 8214, 8216, 8217, 8220, 8221, 8224, 8226, 8228, 8231, 8240, 8240, 8242, 8243, 8245, 8245, 8251, 8251, 8254, 8254, 8308, 8308, 8319, 8319, 8321, 8324, 8364, 8364, 8451, 8451, 8453, 8453, 8457, 8457, 8467, 8467, 8470, 8470, 8481, 8482, 8486, 8486, 8491, 8491, 8531, 8532, 8539, 8542, 8544, 8555, 8560, 8569, 8585, 8585, 8592, 8601, 8632, 8633, 8658, 8658, 8660, 8660, 8679, 8679, 8704, 8704, 8706, 8707, 8711, 8712, 8715, 8715, 8719, 8719, 8721, 8721, 8725, 8725, 8730, 8730, 8733, 8736, 8739, 8739, 8741, 8741, 8743, 8748, 8750, 8750, 8756, 8759, 8764, 8765, 8776, 8776, 8780, 8780, 8786, 8786, 8800, 8801, 8804, 8807, 8810, 8811, 8814, 8815, 8834, 8835, 8838, 8839, 8853, 8853, 8857, 8857, 8869, 8869, 8895, 8895, 8978, 8978, 9312, 9449, 9451, 9547, 9552, 9587, 9600, 9615, 9618, 9621, 9632, 9633, 9635, 9641, 9650, 9651, 9654, 9655, 9660, 9661, 9664, 9665, 9670, 9672, 9675, 9675, 9678, 9681, 9698, 9701, 9711, 9711, 9733, 9734, 9737, 9737, 9742, 9743, 9756, 9756, 9758, 9758, 9792, 9792, 9794, 9794, 9824, 9825, 9827, 9829, 9831, 9834, 9836, 9837, 9839, 9839, 9886, 9887, 9919, 9919, 9926, 9933, 9935, 9939, 9941, 9953, 9955, 9955, 9960, 9961, 9963, 9969, 9972, 9972, 9974, 9977, 9979, 9980, 9982, 9983, 10045, 10045, 10102, 10111, 11094, 11097, 12872, 12879, 57344, 63743, 65024, 65039, 65533, 65533, 127232, 127242, 127248, 127277, 127280, 127337, 127344, 127373, 127375, 127376, 127387, 127404, 917760, 917999, 983040, 1048573, 1048576, 1114109];
var fullwidthRanges = [12288, 12288, 65281, 65376, 65504, 65510];
var halfwidthRanges = [8361, 8361, 65377, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500, 65512, 65518];
var narrowRanges = [32, 126, 162, 163, 165, 166, 172, 172, 175, 175, 10214, 10221, 10629, 10630];
var wideRanges = [4352, 4447, 8986, 8987, 9001, 9002, 9193, 9196, 9200, 9200, 9203, 9203, 9725, 9726, 9748, 9749, 9776, 9783, 9800, 9811, 9855, 9855, 9866, 9871, 9875, 9875, 9889, 9889, 9898, 9899, 9917, 9918, 9924, 9925, 9934, 9934, 9940, 9940, 9962, 9962, 9970, 9971, 9973, 9973, 9978, 9978, 9981, 9981, 9989, 9989, 9994, 9995, 10024, 10024, 10060, 10060, 10062, 10062, 10067, 10069, 10071, 10071, 10133, 10135, 10160, 10160, 10175, 10175, 11035, 11036, 11088, 11088, 11093, 11093, 11904, 11929, 11931, 12019, 12032, 12245, 12272, 12287, 12289, 12350, 12353, 12438, 12441, 12543, 12549, 12591, 12593, 12686, 12688, 12773, 12783, 12830, 12832, 12871, 12880, 42124, 42128, 42182, 43360, 43388, 44032, 55203, 63744, 64255, 65040, 65049, 65072, 65106, 65108, 65126, 65128, 65131, 94176, 94180, 94192, 94198, 94208, 101589, 101631, 101662, 101760, 101874, 110576, 110579, 110581, 110587, 110589, 110590, 110592, 110882, 110898, 110898, 110928, 110930, 110933, 110933, 110948, 110951, 110960, 111355, 119552, 119638, 119648, 119670, 126980, 126980, 127183, 127183, 127374, 127374, 127377, 127386, 127488, 127490, 127504, 127547, 127552, 127560, 127568, 127569, 127584, 127589, 127744, 127776, 127789, 127797, 127799, 127868, 127870, 127891, 127904, 127946, 127951, 127955, 127968, 127984, 127988, 127988, 127992, 128062, 128064, 128064, 128066, 128252, 128255, 128317, 128331, 128334, 128336, 128359, 128378, 128378, 128405, 128406, 128420, 128420, 128507, 128591, 128640, 128709, 128716, 128716, 128720, 128722, 128725, 128728, 128732, 128735, 128747, 128748, 128756, 128764, 128992, 129003, 129008, 129008, 129292, 129338, 129340, 129349, 129351, 129535, 129648, 129660, 129664, 129674, 129678, 129734, 129736, 129736, 129741, 129756, 129759, 129770, 129775, 129784, 131072, 196605, 196608, 262141];

// node_modules/get-east-asian-width/utilities.js
var isInRange = (ranges, codePoint) => {
  let low = 0;
  let high = Math.floor(ranges.length / 2) - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const i = mid * 2;
    if (codePoint < ranges[i]) {
      high = mid - 1;
    } else if (codePoint > ranges[i + 1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
};

// node_modules/get-east-asian-width/lookup.js
var minimumAmbiguousCodePoint = ambiguousRanges[0];
var maximumAmbiguousCodePoint = ambiguousRanges.at(-1);
var minimumFullWidthCodePoint = fullwidthRanges[0];
var maximumFullWidthCodePoint = fullwidthRanges.at(-1);
var minimumHalfWidthCodePoint = halfwidthRanges[0];
var maximumHalfWidthCodePoint = halfwidthRanges.at(-1);
var minimumNarrowCodePoint = narrowRanges[0];
var maximumNarrowCodePoint = narrowRanges.at(-1);
var minimumWideCodePoint = wideRanges[0];
var maximumWideCodePoint = wideRanges.at(-1);
var commonCjkCodePoint = 19968;
var [wideFastPathStart, wideFastPathEnd] = findWideFastPathRange(wideRanges);
function findWideFastPathRange(ranges) {
  let fastPathStart = ranges[0];
  let fastPathEnd = ranges[1];
  for (let index = 0; index < ranges.length; index += 2) {
    const start = ranges[index];
    const end = ranges[index + 1];
    if (commonCjkCodePoint >= start && commonCjkCodePoint <= end) {
      return [start, end];
    }
    if (end - start > fastPathEnd - fastPathStart) {
      fastPathStart = start;
      fastPathEnd = end;
    }
  }
  return [fastPathStart, fastPathEnd];
}
var isAmbiguous = (codePoint) => {
  if (codePoint < minimumAmbiguousCodePoint || codePoint > maximumAmbiguousCodePoint) {
    return false;
  }
  return isInRange(ambiguousRanges, codePoint);
};
var isFullWidth = (codePoint) => {
  if (codePoint < minimumFullWidthCodePoint || codePoint > maximumFullWidthCodePoint) {
    return false;
  }
  return isInRange(fullwidthRanges, codePoint);
};
var isWide = (codePoint) => {
  if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) {
    return true;
  }
  if (codePoint < minimumWideCodePoint || codePoint > maximumWideCodePoint) {
    return false;
  }
  return isInRange(wideRanges, codePoint);
};

// node_modules/get-east-asian-width/index.js
function validate(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// src/ink/stringWidth.ts
var import_strip_ansi = __toESM(require_strip_ansi(), 1);
var EMOJI_REGEX = (0, import_emoji_regex.default)();
function stringWidthJavaScript(str) {
  if (typeof str !== "string" || str.length === 0) {
    return 0;
  }
  let isPureAscii = true;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 127 || code === 27) {
      isPureAscii = false;
      break;
    }
  }
  if (isPureAscii) {
    let width2 = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code > 31) {
        width2++;
      }
    }
    return width2;
  }
  if (str.includes("\x1B")) {
    str = (0, import_strip_ansi.default)(str);
    if (str.length === 0) {
      return 0;
    }
  }
  if (!needsSegmentation(str)) {
    let width2 = 0;
    for (const char of str) {
      const codePoint = char.codePointAt(0);
      if (!isZeroWidth(codePoint)) {
        width2 += eastAsianWidth(codePoint, { ambiguousAsWide: false });
      }
    }
    return width2;
  }
  let width = 0;
  for (const { segment: grapheme } of getGraphemeSegmenter().segment(str)) {
    EMOJI_REGEX.lastIndex = 0;
    if (EMOJI_REGEX.test(grapheme)) {
      width += getEmojiWidth(grapheme);
      continue;
    }
    for (const char of grapheme) {
      const codePoint = char.codePointAt(0);
      if (!isZeroWidth(codePoint)) {
        width += eastAsianWidth(codePoint, { ambiguousAsWide: false });
        break;
      }
    }
  }
  return width;
}
function needsSegmentation(str) {
  for (const char of str) {
    const cp = char.codePointAt(0);
    if (cp >= 127744 && cp <= 129791) return true;
    if (cp >= 9728 && cp <= 10175) return true;
    if (cp >= 127462 && cp <= 127487) return true;
    if (cp >= 65024 && cp <= 65039) return true;
    if (cp === 8205) return true;
  }
  return false;
}
function getEmojiWidth(grapheme) {
  const first = grapheme.codePointAt(0);
  if (first >= 127462 && first <= 127487) {
    let count = 0;
    for (const _ of grapheme) count++;
    return count === 1 ? 1 : 2;
  }
  if (grapheme.length === 2) {
    const second = grapheme.codePointAt(1);
    if (second === 65039 && (first >= 48 && first <= 57 || first === 35 || first === 42)) {
      return 1;
    }
  }
  return 2;
}
function isZeroWidth(codePoint) {
  if (codePoint >= 32 && codePoint < 127) return false;
  if (codePoint >= 160 && codePoint < 768) return codePoint === 173;
  if (codePoint <= 31 || codePoint >= 127 && codePoint <= 159) return true;
  if (codePoint >= 8203 && codePoint <= 8205 || // ZW space/joiner
  codePoint === 65279 || // BOM
  codePoint >= 8288 && codePoint <= 8292) {
    return true;
  }
  if (codePoint >= 65024 && codePoint <= 65039 || codePoint >= 917760 && codePoint <= 917999) {
    return true;
  }
  if (codePoint >= 768 && codePoint <= 879 || codePoint >= 6832 && codePoint <= 6911 || codePoint >= 7616 && codePoint <= 7679 || codePoint >= 8400 && codePoint <= 8447 || codePoint >= 65056 && codePoint <= 65071) {
    return true;
  }
  if (codePoint >= 2304 && codePoint <= 3407) {
    const offset = codePoint & 127;
    if (offset <= 3) return true;
    if (offset >= 58 && offset <= 79) return true;
    if (offset >= 81 && offset <= 87) return true;
    if (offset >= 98 && offset <= 99) return true;
  }
  if (codePoint === 3633 || // Thai MAI HAN-AKAT
  codePoint >= 3636 && codePoint <= 3642 || // Thai vowel signs (skip U+0E32, U+0E33)
  codePoint >= 3655 && codePoint <= 3662 || // Thai vowel signs and marks
  codePoint === 3761 || // Lao MAI KAN
  codePoint >= 3764 && codePoint <= 3772 || // Lao vowel signs (skip U+0EB2, U+0EB3)
  codePoint >= 3784 && codePoint <= 3789) {
    return true;
  }
  if (codePoint >= 1536 && codePoint <= 1541 || codePoint === 1757 || codePoint === 1807 || codePoint === 2274) {
    return true;
  }
  if (codePoint >= 55296 && codePoint <= 57343) return true;
  if (codePoint >= 917504 && codePoint <= 917631) return true;
  return false;
}
var bunStringWidth = typeof Bun !== "undefined" && typeof Bun.stringWidth === "function" ? Bun.stringWidth : null;
var BUN_STRING_WIDTH_OPTS = { ambiguousIsNarrow: true };
var stringWidth = bunStringWidth ? (str) => bunStringWidth(str, BUN_STRING_WIDTH_OPTS) : stringWidthJavaScript;

// src/utils/truncate.ts
function truncateToWidth(text, maxWidth) {
  if (stringWidth(text) <= maxWidth) return text;
  if (maxWidth <= 1) return "\u2026";
  let width = 0;
  let result = "";
  for (const { segment } of getGraphemeSegmenter().segment(text)) {
    const segWidth = stringWidth(segment);
    if (width + segWidth > maxWidth - 1) break;
    result += segment;
    width += segWidth;
  }
  return result + "\u2026";
}
function truncate(str, maxWidth, singleLine = false) {
  let result = str;
  if (singleLine) {
    const firstNewline = str.indexOf("\n");
    if (firstNewline !== -1) {
      result = str.substring(0, firstNewline);
      if (stringWidth(result) + 1 > maxWidth) {
        return truncateToWidth(result, maxWidth);
      }
      return `${result}\u2026`;
    }
  }
  if (stringWidth(result) <= maxWidth) {
    return result;
  }
  return truncateToWidth(result, maxWidth);
}

// src/constants/toolLimits.ts
var MAX_TOOL_RESULT_TOKENS = 1e5;
var BYTES_PER_TOKEN = 4;
var MAX_TOOL_RESULT_BYTES = MAX_TOOL_RESULT_TOKENS * BYTES_PER_TOKEN;
var TOOL_SUMMARY_MAX_LENGTH = 50;

// src/tools/GrepTool/UI.tsx
function getToolUseSummary(input) {
  if (!input?.pattern) {
    return null;
  }
  return truncate(input.pattern, TOOL_SUMMARY_MAX_LENGTH);
}

// src/tools/GrepTool/GrepTool.ts
var inputSchema2 = lazySchema(
  () => z4.strictObject({
    pattern: z4.string().describe(
      "The regular expression pattern to search for in file contents"
    ),
    path: z4.string().optional().describe(
      "File or directory to search in (rg PATH). Defaults to current working directory."
    ),
    glob: z4.string().optional().describe(
      'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob'
    ),
    output_mode: z4.enum(["content", "files_with_matches", "count"]).optional().describe(
      'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".'
    ),
    "-B": semanticNumber(z4.number().optional()).describe(
      //行数
      'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.'
    ),
    "-A": semanticNumber(z4.number().optional()).describe(
      'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.'
    ),
    "-C": semanticNumber(z4.number().optional()).describe("Alias for context."),
    context: semanticNumber(z4.number().optional()).describe(
      'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.'
    ),
    "-n": semanticBoolean(z4.boolean().optional()).describe(
      'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.'
    ),
    "-i": semanticBoolean(z4.boolean().optional()).describe(
      "Case insensitive search (rg -i)"
    ),
    type: z4.string().optional().describe(
      "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types."
    ),
    head_limit: semanticNumber(z4.number().optional()).describe(
      'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 250 when unspecified. Pass 0 for unlimited (use sparingly \u2014 large result sets waste context).'
    ),
    offset: semanticNumber(z4.number().optional()).describe(
      'Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". Works across all output modes. Defaults to 0.'
    ),
    multiline: semanticBoolean(z4.boolean().optional()).describe(
      "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false."
    )
  })
);
var VCS_DIRECTORIES_TO_EXCLUDE = [
  ".git",
  ".svn",
  ".hg",
  ".bzr",
  ".jj",
  ".sl"
];
var DEFAULT_HEAD_LIMIT = 250;
var outputSchema2 = lazySchema(
  () => z4.object({
    mode: z4.enum(["content", "files_with_matches", "count"]).optional(),
    numFiles: z4.number(),
    filenames: z4.array(z4.string()),
    content: z4.string().optional(),
    numLines: z4.number().optional(),
    // For content mode
    numMatches: z4.number().optional(),
    // For count mode
    appliedLimit: z4.number().optional(),
    // The limit that was applied (if any)
    appliedOffset: z4.number().optional()
    // The offset that was applied
  })
);
function applyHeadLimit(items, limit, offset = 0) {
  if (limit === 0) {
    return { items: items.slice(offset), appliedLimit: void 0 };
  }
  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT;
  const sliced = items.slice(offset, offset + effectiveLimit);
  const wasTruncated = items.length - offset > effectiveLimit;
  return {
    items: sliced,
    appliedLimit: wasTruncated ? effectiveLimit : void 0
  };
}
var GrepTool = buildTool({
  name: GREP_TOOL_NAME,
  searchHint: "search file contents with regex (ripgrep)",
  // 20K chars - tool result persistence threshold
  maxResultSizeChars: 2e4,
  async description() {
    return getDescription();
  },
  userFacingName() {
    return "Search";
  },
  getToolUseSummary,
  get inputSchema() {
    return inputSchema2();
  },
  get outputSchema() {
    return outputSchema2();
  },
  isConcurrencySafe() {
    return true;
  },
  isReadOnly() {
    return true;
  },
  async call({
    pattern,
    path: path4,
    glob: glob2,
    type,
    output_mode = "files_with_matches",
    "-B": context_before,
    "-A": context_after,
    "-C": context_c,
    context,
    "-n": show_line_numbers = true,
    "-i": case_insensitive = false,
    head_limit,
    offset = 0,
    multiline = false
  }, { abortController }) {
    const absolutePath = path4 ? expandPath(path4) : getCwd();
    const args = ["--hidden"];
    for (const dir of VCS_DIRECTORIES_TO_EXCLUDE) {
      args.push("--glob", `!${dir}`);
    }
    args.push("--max-columns", "500");
    if (multiline) {
      args.push("-U", "--multiline-dotall");
    }
    if (case_insensitive) {
      args.push("-i");
    }
    if (output_mode === "files_with_matches") {
      args.push("-l");
    } else if (output_mode === "count") {
      args.push("-c");
    }
    if (show_line_numbers && output_mode === "content") {
      args.push("-n");
    }
    if (output_mode === "content") {
      if (context !== void 0) {
        args.push("-C", context.toString());
      } else if (context_c !== void 0) {
        args.push("-C", context_c.toString());
      } else {
        if (context_before !== void 0) {
          args.push("-B", context_before.toString());
        }
        if (context_after !== void 0) {
          args.push("-A", context_after.toString());
        }
      }
    }
    if (pattern.startsWith("-")) {
      args.push("-e", pattern);
    } else {
      args.push(pattern);
    }
    if (type) {
      args.push("--type", type);
    }
    if (glob2) {
      const globPatterns = [];
      const rawPatterns = glob2.split(/\s+/);
      for (const rawPattern of rawPatterns) {
        if (rawPattern.includes("{") && rawPattern.includes("}")) {
          globPatterns.push(rawPattern);
        } else {
          globPatterns.push(...rawPattern.split(",").filter(Boolean));
        }
      }
      for (const globPattern of globPatterns.filter(Boolean)) {
        args.push("--glob", globPattern);
      }
    }
    const results = await ripGrep(args, absolutePath, abortController.signal);
    if (output_mode === "content") {
      const { items: limitedResults, appliedLimit: appliedLimit2 } = applyHeadLimit(
        results,
        head_limit,
        offset
      );
      const finalLines = limitedResults.map((line) => {
        const colonIndex = line.indexOf(":");
        if (colonIndex > 0) {
          const filePath = line.substring(0, colonIndex);
          const rest = line.substring(colonIndex);
          return toRelativePath(filePath) + rest;
        }
        return line;
      });
      const output2 = {
        mode: "content",
        numFiles: 0,
        // Not applicable for content mode
        filenames: [],
        content: finalLines.join("\n"),
        numLines: finalLines.length,
        ...appliedLimit2 !== void 0 && { appliedLimit: appliedLimit2 },
        ...offset > 0 && { appliedOffset: offset }
      };
      return { data: output2 };
    }
    if (output_mode === "count") {
      const { items: limitedResults, appliedLimit: appliedLimit2 } = applyHeadLimit(
        results,
        head_limit,
        offset
      );
      const finalCountLines = limitedResults.map((line) => {
        const colonIndex = line.lastIndexOf(":");
        if (colonIndex > 0) {
          const filePath = line.substring(0, colonIndex);
          const count = line.substring(colonIndex);
          return toRelativePath(filePath) + count;
        }
        return line;
      });
      let totalMatches = 0;
      let fileCount = 0;
      for (const line of finalCountLines) {
        const colonIndex = line.lastIndexOf(":");
        if (colonIndex > 0) {
          const countStr = line.substring(colonIndex + 1);
          const count = parseInt(countStr, 10);
          if (!isNaN(count)) {
            totalMatches += count;
            fileCount += 1;
          }
        }
      }
      const output2 = {
        mode: "count",
        numFiles: fileCount,
        filenames: [],
        content: finalCountLines.join("\n"),
        numMatches: totalMatches,
        ...appliedLimit2 !== void 0 && { appliedLimit: appliedLimit2 },
        ...offset > 0 && { appliedOffset: offset }
      };
      return { data: output2 };
    }
    const stats = await Promise.allSettled(
      results.map((_) => stat2(_))
    );
    const sortedMatches = results.map((_, i) => {
      const r = stats[i];
      return [
        _,
        r.status === "fulfilled" ? r.value.mtimeMs ?? 0 : 0
      ];
    }).sort((a, b) => {
      if (process.env.NODE_ENV === "test") {
        return a[0].localeCompare(b[0]);
      }
      const timeComparison = b[1] - a[1];
      if (timeComparison === 0) {
        return a[0].localeCompare(b[0]);
      }
      return timeComparison;
    }).map((_) => _[0]);
    const { items: finalMatches, appliedLimit } = applyHeadLimit(
      sortedMatches,
      head_limit,
      offset
    );
    const relativeMatches = finalMatches.map(toRelativePath);
    const output = {
      mode: "files_with_matches",
      filenames: relativeMatches,
      numFiles: relativeMatches.length,
      ...appliedLimit !== void 0 && { appliedLimit },
      ...offset > 0 && { appliedOffset: offset }
    };
    return {
      type: "success",
      data: output
    };
  }
});

// src/queryDemo.ts
var client = null;
var model = "gpt-5";
var settingsLoaded = false;
var systemPrompt = "\u5F53\u524D\u5DE5\u4F5C\u76EE\u5F55\u662F F:\\ChatUI-Cli\\src\u3002\u4F7F\u7528\u5DE5\u5177\u67E5\u627E\u6216\u8BFB\u53D6\u9879\u76EE\u6587\u4EF6\u65F6\uFF0C\u9ED8\u8BA4\u4EE5\u8FD9\u4E2A\u76EE\u5F55\u4F5C\u4E3A\u5F53\u524D\u8DEF\u5F84\u3002";
var tools = [
  {
    type: "function",
    function: {
      name: GlobTool.name,
      description: "Find files by glob pattern. Use this when you need to locate files by name or wildcard pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: 'The glob pattern to match files against, for example "**/*.ts" or "src/**/*.json".'
          },
          path: {
            type: "string",
            description: "Optional directory to search in. Omit this field to use the current working directory."
          }
        },
        required: ["pattern"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: GrepTool.name,
      description: "Search file contents with ripgrep regex. Use this to find text, symbols, functions, imports, or matching files.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The regular expression pattern to search for in file contents."
          },
          path: {
            type: "string",
            description: "Optional file or directory to search in. Omit this field to use the current working directory."
          },
          glob: {
            type: "string",
            description: 'Optional glob filter, for example "**/*.ts", "*.{ts,tsx}", or "src/**/*.json".'
          },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
            description: 'Output mode. "content" returns matching lines, "files_with_matches" returns file paths, "count" returns match counts. Defaults to "files_with_matches".'
          },
          "-B": {
            type: "number",
            description: 'Number of context lines before each match. Only used with output_mode "content".'
          },
          "-A": {
            type: "number",
            description: 'Number of context lines after each match. Only used with output_mode "content".'
          },
          "-C": {
            type: "number",
            description: 'Number of context lines before and after each match. Only used with output_mode "content".'
          },
          context: {
            type: "number",
            description: 'Alias for -C. Only used with output_mode "content".'
          },
          "-n": {
            type: "boolean",
            description: "Show line numbers in content mode. Defaults to true."
          },
          "-i": {
            type: "boolean",
            description: "Case-insensitive search."
          },
          type: {
            type: "string",
            description: 'Optional ripgrep file type filter, for example "ts", "js", "py", or "json".'
          },
          head_limit: {
            type: "number",
            description: "Limit returned lines or entries. Defaults to the tool limit when omitted."
          },
          offset: {
            type: "number",
            description: "Skip the first N returned lines or entries before applying head_limit."
          },
          multiline: {
            type: "boolean",
            description: "Enable multiline matching."
          }
        },
        required: ["pattern"],
        additionalProperties: false
      }
    }
  }
];
function resetSettings() {
  client = null;
  settingsLoaded = false;
}
async function ensureClient() {
  if (settingsLoaded && client) return;
  const settingsPath = path3.join(homedir4(), "/.efrex", "setting.json");
  const content = await fs.readFile(settingsPath, "utf-8");
  const settings = JSON.parse(content);
  const apiKey = settings.env?.AUTH_TOKEN || process.env.OPENAI_API_KEY;
  const baseURL = settings.env?.ANTHROPIC_BASE_URL;
  model = settings.env?.ANTHROPIC_MODEL || "gpt-5";
  const configured = Number(settings.env?.REQUEST_TIMEOUT_MS);
  const timeout = Number.isFinite(configured) && configured > 0 ? configured : 12e4;
  client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout });
  settingsLoaded = true;
}
function sleep(ms) {
  return new Promise((resolve4) => setTimeout(resolve4, ms));
}
function createToolAbortController(signal) {
  const abortController = new AbortController();
  if (signal.aborted) {
    abortController.abort(signal.reason);
  } else {
    signal.addEventListener("abort", () => abortController.abort(signal.reason), { once: true });
  }
  return abortController;
}
function parseToolArguments(rawArguments) {
  if (!rawArguments.trim()) return {};
  const parsed = JSON.parse(rawArguments);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object");
  }
  return parsed;
}
function quoteCommandArg(value) {
  return JSON.stringify(value);
}
function getToolCommand(toolName, args) {
  if (toolName === GlobTool.name) {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    return `rg --files --glob ${quoteCommandArg(pattern)} --sort=modified`;
  }
  if (toolName === GrepTool.name) {
    const command = ["rg", "--hidden"];
    const outputMode = typeof args.output_mode === "string" ? args.output_mode : "files_with_matches";
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (args.multiline === true) command.push("-U", "--multiline-dotall");
    if (args["-i"] === true) command.push("-i");
    if (outputMode === "files_with_matches") command.push("-l");
    if (outputMode === "count") command.push("-c");
    if (args["-n"] !== false && outputMode === "content") command.push("-n");
    if (typeof args.context === "number" && outputMode === "content") {
      command.push("-C", String(args.context));
    } else if (typeof args["-C"] === "number" && outputMode === "content") {
      command.push("-C", String(args["-C"]));
    } else if (outputMode === "content") {
      if (typeof args["-B"] === "number") command.push("-B", String(args["-B"]));
      if (typeof args["-A"] === "number") command.push("-A", String(args["-A"]));
    }
    if (pattern.startsWith("-")) {
      command.push("-e", quoteCommandArg(pattern));
    } else {
      command.push(quoteCommandArg(pattern));
    }
    if (typeof args.type === "string") command.push("--type", quoteCommandArg(args.type));
    if (typeof args.glob === "string") command.push("--glob", quoteCommandArg(args.glob));
    if (typeof args.path === "string") command.push(quoteCommandArg(args.path));
    return command.join(" ");
  }
  return `${toolName} ${JSON.stringify(args)}`;
}
function logToolCall(message) {
  console.info(`[tool] ${message}`);
}
async function callTool(toolCall, signal) {
  try {
    const rawArgs = parseToolArguments(toolCall.function.arguments);
    const toolContext = {
      options: { debug: false, verbose: false },
      abortController: createToolAbortController(signal),
      globLimits: { maxResults: 100 }
    };
    if (toolCall.function.name === GlobTool.name) {
      const args = GlobTool.inputSchema.parse(rawArgs);
      const searchPath = args.path ? expandPath(args.path) : getCwd();
      const cwdInfo = `cwd: ${searchPath}`;
      logToolCall(`call ${GlobTool.name}: ${getToolCommand(GlobTool.name, args)} (${cwdInfo})`);
      const result = await GlobTool.call(args, toolContext);
      logToolCall(
        `done ${GlobTool.name}: ${result.data.numFiles} files in ${result.data.durationMs}ms` + (result.data.truncated ? " (truncated)" : "")
      );
      return JSON.stringify(result);
    }
    if (toolCall.function.name === GrepTool.name) {
      const args = GrepTool.inputSchema.parse(rawArgs);
      const searchPath = args.path ? expandPath(args.path) : getCwd();
      const cwdInfo = `cwd: ${searchPath}`;
      logToolCall(`call ${GrepTool.name}: ${getToolCommand(GrepTool.name, args)} (${cwdInfo})`);
      const result = await GrepTool.call(args, toolContext);
      const extra = result.data.mode === "content" ? `, ${result.data.numLines ?? 0} lines` : result.data.mode === "count" ? `, ${result.data.numMatches ?? 0} matches` : "";
      logToolCall(`done ${GrepTool.name}: ${result.data.numFiles} files${extra}`);
      return JSON.stringify(result);
    }
    return JSON.stringify({
      type: "error",
      error: `Unknown tool: ${toolCall.function.name}`
    });
  } catch (error) {
    logToolCall(`error ${toolCall.function.name}: ${error?.message || String(error)}`);
    return JSON.stringify({
      type: "error",
      error: error?.message || String(error)
    });
  }
}
function toToolCalls(toolCallsByIndex) {
  return [...toolCallsByIndex.entries()].sort(([left], [right]) => left - right).map(([, toolCall]) => ({
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments
    }
  }));
}
async function streamCompletion(messages, signal, onChunk, onReasoningStart, onReasoningEnd, enableTools = false) {
  const requestParams = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...enableTools ? { tools, tool_choice: "auto" } : {}
  };
  captureAPIRequest(requestParams, { includeMessages: false });
  const stream = await client.chat.completions.create(requestParams, { signal });
  const toolCallsByIndex = /* @__PURE__ */ new Map();
  let fullText = "";
  let reasoningText = "";
  let usage = void 0;
  let reasoningStartTime = null;
  let reasoningEndTime = null;
  let isReasoning = false;
  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = chunk.usage;
    }
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index;
        const existing = toolCallsByIndex.get(index) ?? { id: "", name: "", arguments: "" };
        if (toolCallDelta.id) existing.id = toolCallDelta.id;
        if (toolCallDelta.function?.name) existing.name += toolCallDelta.function.name;
        if (toolCallDelta.function?.arguments) existing.arguments += toolCallDelta.function.arguments;
        toolCallsByIndex.set(index, existing);
      }
    }
    if ("reasoning_content" in delta && delta.reasoning_content) {
      if (!isReasoning) {
        isReasoning = true;
        reasoningStartTime = Date.now();
        onReasoningStart?.();
      }
      reasoningText += delta.reasoning_content;
    }
    if (delta.content) {
      if (isReasoning && reasoningStartTime && !reasoningEndTime) {
        isReasoning = false;
        reasoningEndTime = Date.now();
        const duration = reasoningEndTime - reasoningStartTime;
        onReasoningEnd?.(duration);
      }
      fullText += delta.content;
      onChunk?.(fullText);
    }
  }
  if (isReasoning && reasoningStartTime && !reasoningEndTime) {
    reasoningEndTime = Date.now();
    onReasoningEnd?.(reasoningEndTime - reasoningStartTime);
  }
  const reasoningDurationMs = reasoningStartTime && reasoningEndTime ? reasoningEndTime - reasoningStartTime : 0;
  return {
    text: fullText,
    reasoningText,
    usage,
    reasoningDurationMs,
    toolCalls: toToolCalls(toolCallsByIndex)
  };
}
function isRetryableError(error) {
  const status = error?.status || error?.response?.status;
  const message = String(error?.message || "").toLowerCase();
  return status === 429 || // 限流
  status === 500 || status === 502 || status === 503 || status === 504 || error.code === "ETIMEDOUT" || error.code === "ECONNRESET" || error.name === "APIConnectionTimeoutError" || message.includes("timed out") || message.includes("timeout");
}
async function doStreamRequest(input, signal) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input }
  ];
  const firstResult = await streamCompletion(messages, signal, void 0, void 0, void 0, true);
  if (firstResult.toolCalls.length === 0) {
    return firstResult.text || "\u6CA1\u6709\u62FF\u5230\u56DE\u590D";
  }
  messages.push({
    role: "assistant",
    content: firstResult.text || null,
    tool_calls: firstResult.toolCalls
  });
  for (const toolCall of firstResult.toolCalls) {
    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: await callTool(toolCall, signal)
    });
  }
  const secondResult = await streamCompletion(messages, signal);
  return secondResult.text || firstResult.text || "\u6CA1\u6709\u62FF\u5230\u56DE\u590D";
}
async function askOpenAI(input, signal, onRetry, onChunk, onReasoningStart, onReasoningEnd) {
  const maxRetries = 5;
  const baseDelay = 500;
  await ensureClient();
  try {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input }
    ];
    const firstResult = await streamCompletion(
      messages,
      signal,
      onChunk,
      onReasoningStart,
      onReasoningEnd,
      true
    );
    if (firstResult.toolCalls.length === 0) {
      return {
        text: firstResult.text || "\u6CA1\u6709\u62FF\u5230\u56DE\u590D",
        reasoningText: firstResult.reasoningText,
        usage: firstResult.usage,
        reasoningDurationMs: firstResult.reasoningDurationMs
      };
    }
    const assistantMessage = {
      role: "assistant",
      content: firstResult.text || null,
      tool_calls: firstResult.toolCalls
    };
    messages.push(assistantMessage);
    for (const toolCall of firstResult.toolCalls) {
      const content = await callTool(toolCall, signal);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content
      });
    }
    const secondResult = await streamCompletion(
      messages,
      signal,
      onChunk,
      void 0,
      void 0,
      false
    );
    return {
      text: secondResult.text || firstResult.text || "\u6CA1\u6709\u62FF\u5230\u56DE\u590D",
      reasoningText: [firstResult.reasoningText, secondResult.reasoningText].filter(Boolean).join(""),
      usage: secondResult.usage ?? firstResult.usage,
      reasoningDurationMs: firstResult.reasoningDurationMs + secondResult.reasoningDurationMs
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      console.log("\u8BF7\u6C42\u5DF2\u53D6\u6D88");
      return { text: "", reasoningText: "", reasoningDurationMs: 0 };
    }
    if (isRetryableError(error)) {
      let attempt = 0;
      while (true) {
        try {
          const result = await doStreamRequest(input, signal);
          return { text: result, reasoningText: "", reasoningDurationMs: 0 };
        } catch (error2) {
          if (error2?.name === "AbortError") {
            console.log("\u8BF7\u6C42\u5DF2\u53D6\u6D88");
            return { text: "", reasoningText: "", reasoningDurationMs: 0 };
          }
          attempt++;
          if (attempt >= maxRetries || !isRetryableError(error2)) {
            throw error2;
          }
          onRetry?.(attempt, maxRetries);
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
          await sleep(delay);
        }
      }
    } else throw error;
  }
}

export {
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
  attachErrorLogSink,
  logError,
  createFileErrorSink,
  resetSettings,
  askOpenAI
};
