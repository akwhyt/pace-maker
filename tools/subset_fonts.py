import sys, re, pathlib
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
root = pathlib.Path(sys.argv[1]); dl = pathlib.Path(sys.argv[2])
text = ''.join((root/f).read_text(encoding='utf-8') for f in ['index.html','app.js'])
jp = sorted({c for c in text if ord(c) > 0x2000})
ascii_ = ''.join(chr(i) for i in range(0x20,0x7f))
extra = '×→（）／・…'
jp_text = ''.join(jp) + extra + ascii_
print('JP chars:', len(jp)); open(str(dl/'jp.txt'),'w',encoding='utf-8').write(''.join(jp))
def build(src, out, txt, limits):
    f = TTFont(src)
    opts = subset.Options(); opts.layout_features=['*']; opts.name_IDs=['*']; opts.notdef_outline=True; opts.glyph_names=False
    s = subset.Subsetter(opts); s.populate(text=txt); s.subset(f)
    f = instancer.instantiateVariableFont(f, limits)
    f.flavor='woff2'; f.save(out); print(out, pathlib.Path(out).stat().st_size)
build(dl/'Inter.ttf', root/'fonts/inter-sub.woff2', ascii_ + '×→–—…', {'wght':(400,700),'opsz':(14,32)})
build(dl/'NotoSansJP.ttf', root/'fonts/notosansjp-sub.woff2', jp_text, {'wght':(400,700)})
