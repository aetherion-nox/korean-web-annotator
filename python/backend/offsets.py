"""Original Python indices to JavaScript UTF-16 code units."""
def to_utf16(text: str, index: int) -> int:
    if not 0 <= index <= len(text):
        raise ValueError('Offset outside original text')
    return len(text[:index].encode('utf-16-le', errors='surrogatepass')) // 2
