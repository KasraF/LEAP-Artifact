import re
import io
import base64
from typing import List, Optional, Tuple
import numpy as np
import tokenize
from PIL import Image
import matplotlib.pyplot as plt

# Code manipulation

magic_var_name = "__run_py__"


def remove_comments_and_docstrings(source):
    '''
    Reference:
    https://stackoverflow.com/questions/1769332/script-to-remove-python-comments-docstrings
    '''
    io_obj = io.StringIO(source)
    out = ''
    prev_toktype = tokenize.INDENT
    last_lineno = -1
    last_col = 0
    for tok in tokenize.generate_tokens(io_obj.readline):
        token_type = tok[0]
        token_string = tok[1]
        start_line, start_col = tok[2]
        end_line, end_col = tok[3]
        ltext = tok[4]
        if start_line > last_lineno:
            last_col = 0
        if start_col > last_col:
            out += " " * (start_col - last_col)
        if token_type == tokenize.COMMENT:
            if prev_toktype == tokenize.INDENT or prev_toktype == tokenize.NEWLINE:
                out += ''
        elif token_type == tokenize.STRING:
            if prev_toktype != tokenize.INDENT:
                # NL == an empty line
                if prev_toktype != tokenize.NEWLINE and prev_toktype != tokenize.NL:
                    # not a docstring
                    if start_col > 0:
                        out += token_string
                else:
                    # a top-level docstring
                    out += '\n' * (end_line - start_line)
            else:
                # a docstring within function
                out += '\n' * (end_line - start_line)
        else:
            out += token_string
        prev_toktype = token_type
        last_col = end_col
        last_lineno = end_line

    # add the \n character back to each line
    res = list(map(lambda s: s + '\n', out.split('\n')))
    return res


def replace_empty_lines_with_noop(lines):

    curr_indent = -1
    curr_indent_str = ""
    for i in range(len(lines)):
        line = lines[i]
        stripped = line.strip()
        if stripped == "":
            if curr_indent != -1:
                lines[i] = curr_indent_str + "    "
        elif stripped[-1] == ":":
            curr_indent = len(line) - len(line.lstrip())
            curr_indent_str = line[0:curr_indent]
        else:
            curr_indent = -1

    ws_computed = ""
    for i in range(len(lines)-1, 0, -1):
        line = lines[i]
        if (line.strip() == ""):
            ws_len_user = len(line.rstrip('\n'))
            ws_len_computed = len(ws_computed)
            if ws_len_user > ws_len_computed:
                ws = line.rstrip('\n')
            else:
                ws = ws_computed
            # note: we cannot use pass here because the Python Debugger
            # Framework (bdb) does not stop at pass statements
            lines[i] = ws + magic_var_name + " = 0\n"
        else:
            ws_len = len(line) - len(line.lstrip())
            ws_computed = line[0:ws_len]


def load_code_lines(file_name: str) -> Tuple[List[str], Optional[Exception]]:
    with open(file_name) as f:
        source = f.read()
    try:
        lines = remove_comments_and_docstrings(source)
        replace_empty_lines_with_noop(lines)
        return (lines, None)
    except Exception as e1:
        # There was a parse error.
        # We can't show e1 to the user, since it's from the parsing module,
        # not the actual user-facing error message.
        # So we `exec` the code to get the user-facing one :|
        try:
            exec(source)
        except Exception as e2:
            return ([], e2)

        # This code _should_ never execute, but better safe than sorry
        return ([], e1)

# Image Processing


def is_ndarray_img(v):
    return isinstance(v, np.ndarray) and v.dtype.name == 'uint8' and len(v.shape) == 3 and v.shape[2] == 3


def is_list_img(v):
    if not isinstance(v, list):
        return False
    if not len(v) > 0:
        return False
    if not isinstance(v[0], list):
        return False
    if not len(v[0]) > 0:
        return False
    if not (isinstance(v[0][0], list) or isinstance(v[0][0], tuple)):
        return False
    if not len(v[0][0]) == 3:
        return False
    if not isinstance(v[0][0][0], int):
        return False
    if not isinstance(v[0][0][1], int):
        return False
    if not isinstance(v[0][0][2], int):
        return False
    return True


def if_img_convert_to_html(v):
    if is_list_img(v):
        return list_to_html(v, format='png')
    elif is_ndarray_img(v):
        return ndarray_to_html(v, format='png')
    else:
        return None

# Convert PIL.Image to html


def pil_to_html(img, **kwargs):
    file_buffer = io.BytesIO()
    img.save(file_buffer, **kwargs)
    encoded = base64.b64encode(file_buffer.getvalue())
    encoded_str = str(encoded)[2:-1]
    img_format = kwargs["format"]
    return f"<img src='data:image/{img_format};base64,{encoded_str}'>"

# Convert ndarray to PIL.Image


def ndarray_to_pil(arr, min_width=None, max_width=None):
    img = Image.fromarray(arr)
    h = img.height
    w = img.width
    new_width = None
    if w > max_width:
        new_width = max_width
    if w < min_width:
        new_width = min_width
    if new_width != None:
        img = img.resize((new_width, int(h*(new_width / w))),
                         resample=Image.BOX)
    return img

# Convert list of lists to ndarray


def list_to_ndarray(arr):
    return np.asarray(arr, dtype=np.uint8)


def ndarray_to_html(arr, **kwargs):
    return pil_to_html(ndarray_to_pil(arr, 150, 170), **kwargs)


def list_to_html(arr, **kwargs):
    return ndarray_to_html(list_to_ndarray(arr), **kwargs)

# Matplotlib


def matplotlib_fig_as_html():
    file_buffer = io.BytesIO()
    plt.savefig(file_buffer, format='png')
    encoded = base64.b64encode(file_buffer.getvalue())
    encoded_str = str(encoded)[2:-1]
    return f"<img src='data:image/png;base64,{encoded_str}' width=400>"
