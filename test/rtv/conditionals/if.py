def try_if(l):
	ret = 0
	for x in l:
		if x == 1:
			ret += 2
		elif x == 0:
			ret += 4
		else:
			ret -= 2
	return ret


try_if([0, 1, 0, 1, 2, 3])
