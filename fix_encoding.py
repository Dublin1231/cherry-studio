import os, chardet, codecs; def fix_file_encoding(file_path): raw_data = open(file_path, 'rb').read(); result = chardet.detect(raw_data); encoding = result['encoding']; content = raw_data.decode(encoding) if encoding else raw_data.decode('utf-8'); open(file_path, 'w', encoding='utf-8').write(content); dir_path = 'src/main/db'; [fix_file_encoding(os.path.join(root, file)) for root, dirs, files in os.walk(dir_path) for file in files if file.endswith('.ts')]
