def task(s):
    # Return the most frequent bigram in string s
    res = ""
    max_count = 0
    for i in range(len(s) - 1):
        bigram = s[i:i+2]
        count = s.count(bigram)
        print(max_count)
    return res


task("afdbdfibfcfdebdfdebdihgfkjebd")
