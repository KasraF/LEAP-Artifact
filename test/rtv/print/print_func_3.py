a  = 10

def foo():
    global a
    a = a + 1
    return a

# expects to see a=10 in PB for the line below, but now it is showing 11
print(a, foo())
