import itertools
import matplotlib.pyplot as plt

"""
one comment

"""

def foo():

    """hello
    """

    return 0

a = foo()

data = [180,250,130,50]

fig, ax = plt.subplots()

# plot the data using a bar
ax.bar(range(len(data)), data, color=['#FF0000','#00FF00','#0000FF','#FFFF00'])

# add a title and a label for the y axis
ax.set_title('Data')
ax.set_ylabel('Value')

# add a label for each bar
ax.set_xticks(range(len(data)))
ax.set_xticklabels(['A','B','C','D'])

# add a grid
ax.grid(True)

# show the plot
