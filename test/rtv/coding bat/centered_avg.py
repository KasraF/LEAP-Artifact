def centered_average(nums):
	sum = 0
	for element in nums:
		if element is min(nums):
			pass
		elif element is max(nums):
			pass
		else:
			sum += element
	return sum / (len(nums)-2)


centered_average([1, 2, 3, 4])
