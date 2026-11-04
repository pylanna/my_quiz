// QR code for the join link. Uses the vendored qrcode-generator (public/vendor/qrcode.js).
// matrix/pathData are pure so tests can decode what the page would draw.
(function () {
  var QUIET_ZONE = 4; // modules of white around the code; scanners need at least 4

  /** Boolean grid (true = dark) for `text`, error correction M, smallest version that fits. */
  function matrix(qrcodeFn, text) {
    var qr = qrcodeFn(0, "M");
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var rows = [];
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) row.push(qr.isDark(r, c));
      rows.push(row);
    }
    return rows;
  }

  function viewBoxSize(n) {
    return n + 2 * QUIET_ZONE;
  }

  /** SVG path data: one unit square per dark module, offset by the quiet zone. Digits and commands only. */
  function pathData(rows) {
    var d = "";
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c]) d += "M" + (c + QUIET_ZONE) + " " + (r + QUIET_ZONE) + "h1v1h-1z";
      }
    }
    return d;
  }

  /** SVG element for the page, built with DOM calls (no innerHTML). */
  function svg(text, label) {
    var NS = "http://www.w3.org/2000/svg";
    var rows = matrix(window.qrcode, text);
    var size = viewBoxSize(rows.length);
    var root = document.createElementNS(NS, "svg");
    root.setAttribute("viewBox", "0 0 " + size + " " + size);
    root.setAttribute("class", "qr");
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", label);
    root.setAttribute("shape-rendering", "crispEdges");
    var bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", size);
    bg.setAttribute("height", size);
    bg.setAttribute("fill", "#fff");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", pathData(rows));
    path.setAttribute("fill", "#000");
    root.appendChild(bg);
    root.appendChild(path);
    return root;
  }

  var api = { QUIET_ZONE: QUIET_ZONE, matrix: matrix, viewBoxSize: viewBoxSize, pathData: pathData, svg: svg };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.QZ.qr = api;
})();
