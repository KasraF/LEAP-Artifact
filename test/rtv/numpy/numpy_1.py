import itertools
import matplotlib.pyplot as plt


data = [180,250,130,50]


# plot a bar chart
plt.bar(range(len(data)), data)


# label x axis
plt.xticks(range(len(data)), ['Fall', 'Winter', 'Spring', 'Summer'])


# change color of each bar
colors = ['red', 'green', 'yellow', 'blue']
for i, d in enumerate(data):
    plt.gca().patches[i].set_color(colors[i])


# add values to each bar
for i, d in enumerate(data):
    plt.text(i, d, str(d), ha='center', va='bottom')


# add title
plt.title('Enrollments by Quarter')
