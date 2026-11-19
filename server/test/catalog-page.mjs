// A number's page as the open catalogue writes one — for the tests: an invented part of an invented car.
export function catalogHtml({ number, formatted, name, brand = 'Toyota', slug = 'toyota', superseded = false, replaces = false, family = [], diagrams = [], ld = true }) {
  const fam = family.map((f, i) => `{id:${900 + i},number:"${f.replace(/[^A-Z0-9]/g, '')}",numberFormatted:"${f}",name:"${name}",slug:"x",uid:"${slug}-${f}",brand:{slug:"${slug}",name:"${brand}"},notes:[],supersessions:[],reverseSupersessions:[]}`).join(',');
  const own = `part:{id:7,number:"${number}",numberFormatted:"${formatted}",name:"${name}",slug:"x",uid:"${slug}-${number}",brand:{slug:"${slug}",name:"${brand}"},notes:[],supersessions:[${superseded ? '{type:0,descriptionValueId:null,supersessionSet:[{partId:900,quantity:1}]}' : ''}],reverseSupersessions:[${replaces ? '900' : ''}]},supersessions:[${fam}]`;
  const dia = diagrams.map((d) => `{image:"${d.image}",name:"${d.name}",text:{header:"${d.header}",subHeader:[${d.sub.map((x) => `"${x}"`).join(',')}]},areas:[${(d.areas ?? []).map((a) => `{x1:${a[0]},y1:${a[1]},x2:${a[2]},y2:${a[3]}}`).join(',')}]}`).join(',');
  return `<html><head><title>${formatted} Genuine ${brand} ${name} | Megazip</title>
${ld ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, mpn: formatted, brand: { '@type': 'Brand', name: brand } })}</script>` : ''}
</head><body><script>{ data: {"l2c2g1/getPart/W1s":{v:{${own}}},"l2c2g1/getPartDiagrams/W1s":{v:{diagrams:[${dia}]}},"lyztek/getPartRating/":{v:{score:4}}} }</script></body></html>`;
}
