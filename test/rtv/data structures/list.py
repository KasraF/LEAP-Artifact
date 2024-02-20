class Node:
	dataVal = None

	def __init__(self, dataval=None):
		self.dataVal = dataval
		self.nextVal = None

	def __repr__(self):
		return str(self.dataVal)


class SLinkedList:
	headval = None

	def __init__(self):
		self.headval = None

	def __repr__(self):
		if self.headval is not None:
			rep = ''
			printval = self.headval
			while printval is not None:
				rep += str(printval.dataVal) + '->'
				printval = printval.nextVal
			return rep
		return ''


def append(list, newdata):
	list. headval = Node(1)
	list.headval.nextVal = Node(2)
	node = Node(newdata)
	if list.headval is None:
		list.headval = node
		return
	last = list.headval
	while(last.nextVal):
		last = last.nextVal
	last.nextval = node


list = SLinkedList()
append(list, 3)
