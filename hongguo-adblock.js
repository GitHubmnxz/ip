/**
 * 红果短剧 去广告脚本  (Loon http-response)
 * ---------------------------------------------------------------
 * 原理：红果广告物料随业务接口以 JSON 内嵌 item 下发，
 *       本脚本在响应返回 App 前删除广告节点。
 *
 * MODE = "probe"  只记日志、不改响应（用于确认字段，安全）
 * MODE = "filter" 删除广告节点（默认）
 *
 * AGGRESSIVE = true  额外按 ad_id / material_id 判定，命中率更高但误删风险上升
 * ---------------------------------------------------------------
 */
var MODE = "filter";
var AGGRESSIVE = false;
var DEBUG = true;

var AD_TYPE_WORDS = [
  "ad", "ads", "advert", "advertisement", "app_ad", "feed_ad",
  "splash_ad", "banner_ad", "insert_ad", "reward_ad", "video_ad",
  "ad_card", "ad_item", "ad_splash", "ad_banner", "mixed_ad"
];

function lower(v) {
  return typeof v === "string" ? v.toLowerCase() : "";
}

function hitAdType(o) {
  var keys = ["type", "cell_type", "card_type", "item_type", "content_type", "style", "sub_type"];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (o[k] === undefined || o[k] === null) continue;
    var v = lower(o[k]);
    if (v && AD_TYPE_WORDS.indexOf(v) >= 0) return k + "=" + o[k];
  }
  return null;
}

function hitFlag(o) {
  if (o.is_ad === 1 || o.is_ad === true || o.is_ad === "1") return "is_ad";
  if (o.isAd === 1 || o.isAd === true) return "isAd";
  if (o.ad_type !== undefined && o.ad_type !== null && o.ad_type !== 0 && o.ad_type !== "") return "ad_type";
  if (o.adType !== undefined && o.adType !== null && o.adType !== 0 && o.adType !== "") return "adType";
  if (o.ad_info && typeof o.ad_info === "object" && Object.keys(o.ad_info).length) return "ad_info";
  if (o.adInfo && typeof o.adInfo === "object" && Object.keys(o.adInfo).length) return "adInfo";
  if (o.creative_id && (o.log_extra || o.ad_info || o.adInfo)) return "creative_id+meta";
  if (AGGRESSIVE && (o.ad_id || o.adid || o.material_id)) return "ad_id";
  return null;
}

function isAdNode(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  return hitAdType(o) || hitFlag(o);
}

function summarize(o) {
  var out = [];
  var n = 0;
  for (var k in o) {
    if (n++ > 14) break;
    var v = o[k];
    var s = (v && typeof v === "object") ? "[obj]" : String(v);
    out.push(k + "=" + s.slice(0, 50));
  }
  return out.join(", ");
}

var removedLog = [];

function walk(node, depth) {
  if (depth > 12) return 0;
  var n = 0;
  if (Array.isArray(node)) {
    for (var i = node.length - 1; i >= 0; i--) {
      var hit = isAdNode(node[i]);
      if (hit) {
        if (removedLog.length < 5) {
          removedLog.push("[" + hit + "] {" + summarize(node[i]) + "}");
        }
        node.splice(i, 1);
        n++;
      } else {
        n += walk(node[i], depth + 1);
      }
    }
    return n;
  }
  if (node && typeof node === "object") {
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      n += walk(node[k], depth + 1);
    }
  }
  return n;
}

/* 诊断：找出疑似广告字段但未被删除的位置，用于迭代规则 */
function scanSuspicious(node, path, hits, depth) {
  if (depth > 3 || hits.length > 12) return;
  if (Array.isArray(node)) {
    var limit = Math.min(node.length, 3);
    for (var i = 0; i < limit; i++) scanSuspicious(node[i], path + "[" + i + "]", hits, depth + 1);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (var k in node) {
    if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
    if (/^(is_?ad|ad_?type|ad_?info|creative_?id|rit|log_?extra|splash|banner|ad_?id)$/i.test(k)) {
      var s;
      try { s = JSON.stringify(node[k]).slice(0, 70); } catch (e) { s = "[?]"; }
      hits.push(path + "." + k + "=" + s);
    }
    scanSuspicious(node[k], path + "." + k, hits, depth + 1);
  }
}

function main() {
  var url = $request.url || "";
  var shortUrl = url.split("?")[0].slice(0, 110);
  var body = $response.body;
  var ct = "";
  try { ct = ($response.headers && ($response.headers["Content-Type"] || $response.headers["content-type"])) || ""; } catch (e) {}

  if (!body) { $done({}); return; }

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    if (DEBUG) {
      var head = String(body).slice(0, 24).replace(/[\x00-\x1f]/g, ".");
      console.log("[红果] 非JSON " + shortUrl + " len=" + body.length + " ct=" + ct + " head=" + head);
    }
    $done({});
    return;
  }

  removedLog = [];
  var n = walk(json, 0);

  if (n > 0) {
    console.log("[红果] 命中 " + shortUrl + " → 移除广告 " + n + " 条");
    for (var i = 0; i < removedLog.length; i++) console.log("    " + removedLog[i]);
    if (MODE === "filter") {
      $done({ body: JSON.stringify(json) });
    } else {
      console.log("[红果] probe 模式，未修改响应");
      $done({});
    }
    return;
  }

  if (DEBUG) {
    var hits = [];
    scanSuspicious(json, "$", hits, 0);
    if (hits.length) {
      console.log("[红果] 疑似广告字段但未命中 " + shortUrl);
      for (var j = 0; j < hits.length; j++) console.log("    ? " + hits[j]);
    }
  }
  $done({});
}

main();
