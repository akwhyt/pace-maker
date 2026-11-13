import sys, pathlib
from PIL import Image, ImageDraw, ImageFilter
out = pathlib.Path(sys.argv[1])
BG=(2,10,4,255); CARD=(6,26,12,255); ACC=(0,255,65,255); DIV=(15,61,30,255)
def make(size, maskable=False, rounded=False):
    S=size*4
    im=Image.new('RGBA',(S,S),BG)
    d=ImageDraw.Draw(im)
    scale = 0.62 if maskable else 0.80
    r=S*scale/2; cx=cy=S/2; w=S*0.075*(scale/0.8)
    box=[cx-r,cy-r,cx+r,cy+r]
    d.ellipse(box,outline=DIV,width=int(w))
    glow=Image.new('RGBA',(S,S),(0,0,0,0)); g=ImageDraw.Draw(glow)
    g.arc(box,start=-90,end=180,fill=ACC,width=int(w))
    blur=glow.filter(ImageFilter.GaussianBlur(S*0.02))
    im=Image.alpha_composite(im,blur); im=Image.alpha_composite(im,glow)
    d=ImageDraw.Draw(im)
    # hand
    hw=w*0.7
    d.line([(cx,cy),(cx,cy-r*0.55)],fill=(196,255,210,255),width=int(hw))
    d.line([(cx,cy),(cx+r*0.4,cy)],fill=(196,255,210,255),width=int(hw))
    d.ellipse([cx-hw,cy-hw,cx+hw,cy+hw],fill=ACC)
    im=im.resize((size,size),Image.LANCZOS)
    return im
make(192).save(out/'icon-192.png')
make(512).save(out/'icon-512.png')
make(512,maskable=True).save(out/'icon-maskable-512.png')
make(180).convert('RGB').save(out/'apple-touch-icon.png')
