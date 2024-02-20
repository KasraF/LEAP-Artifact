import math


def bin_search(a, k):
	lo = 0
	hi = len(a)-1
	while 1:
		mid = math.floor((lo+hi)/2)
		val = a[mid]
		if val < k:
			lo = mid+1
		elif val > k:
			hi = mid-1
		else:
			return mid
	return -1


bin_search(["a", "b", "c", "d", "e"], "g")
