import struct,json
from pathlib import Path
b=Path('/System/Library/Fonts/Supplemental/Arial Bold.ttf').read_bytes()
u16=lambda o:struct.unpack_from('>H',b,o)[0]
u32=lambda o:struct.unpack_from('>I',b,o)[0]
tables={b[12+i*16:16+i*16].decode():u32(20+i*16) for i in range(u16(4))}
units=u16(tables['head']+18);count=u16(tables['hhea']+34);hmtx=tables['hmtx'];cmap=tables['cmap'];maps=[]
for i in range(u16(cmap+2)):
 p=cmap+u32(cmap+8+i*8)
 if u16(p)==4:maps.append(p)
p=maps[-1];n=u16(p+6)//2;ends=p+14;starts=ends+2*n+2;deltas=starts+2*n;ranges=deltas+2*n
widths={}
for i in range(n):
 for cp in range(u16(starts+i*2),min(u16(ends+i*2)+1,65535)):
  delta=u16(deltas+i*2);r=u16(ranges+i*2)
  g=u16(ranges+i*2+r+2*(cp-u16(starts+i*2))) if r else (cp+delta)%65536
  if r and g:g=(g+delta)%65536
  if g:widths[str(cp)]=round(u16(hmtx+4*min(g,count-1))/units,6)
Path('src/shared/arial-bold-widths.json').write_text(json.dumps(widths,separators=(',',':'))+'\n')
