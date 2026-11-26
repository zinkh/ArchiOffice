import zlib from 'node:zlib';
export function imageFixture(){
 const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const label=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([label,data])));return Buffer.concat([length,label,data,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
 const pixels=Buffer.from([0,255,0,0,255,0,0,0,0,0,255,0,0,255]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
export function pdfFixture(){
 const text=t=>`BT /F1 18 Tf 20 100 Td (${t}) Tj ET`;
 const first=text('ArchiOffice fixture page 1'),second=text('Page 2');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',`<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',`<< /Length ${second.length} >>\nstream\n${second}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 let result='%PDF-1.4\n';const offsets=[0];for(const [index,body]of objects.entries()){offsets.push(Buffer.byteLength(result));result+=`${index+1} 0 obj\n${body}\nendobj\n`;}
 const xref=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(const offset of offsets.slice(1))result+=`${String(offset).padStart(10,'0')} 00000 n \n`;
 return Buffer.from(result+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
