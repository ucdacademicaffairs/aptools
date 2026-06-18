import urllib.request
import re
from PyPDF2 import PdfReader

link = "https://www.ucop.edu/academic-personnel-programs/_files/2025-26/policy-covered-july-2025-scales/t14-a-n.pdf"
req = urllib.request.Request(link, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as response, open("test_n.pdf", 'wb') as out_file:
    out_file.write(response.read())

def clean_money(s):
    return float(s.replace('$', '').replace(',', ''))

reader_pdf = PdfReader("test_n.pdf")
text = ""
for page in reader_pdf.pages:
    text += page.extract_text() + "\n"

lines = text.split('\n')
for line in lines:
    if '$' not in line:
        continue
    print(f"RAW: {line}")
    money_matches = re.findall(r'\$[\d,]+\.\d{2}|\$[\d,]+', line)
    print(f"MATCHES: {money_matches}")
