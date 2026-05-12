/** Convert a glob pattern to a RegExp that matches against a forward-slash path. */
export function globToRegExp(glob: string): RegExp {
  let i = 0;
  let out = "^";
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // ** — match any number of path segments
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i++;
    } else if (ch === "{") {
      // brace expansion: {a,b,c}
      const close = glob.indexOf("}", i);
      if (close === -1) {
        out += "\\{";
        i++;
      } else {
        const inner = glob.slice(i + 1, close);
        const parts = inner.split(",").map((p) => p.replace(/[.+^$()|[\]\\]/g, (s) => `\\${s}`));
        out += `(?:${parts.join("|")})`;
        i = close + 1;
      }
    } else if (ch === ".") {
      out += "\\.";
      i++;
    } else if (/[+^$()|[\]\\]/.test(ch)) {
      out += `\\${ch}`;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  out += "$";
  return new RegExp(out);
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}
