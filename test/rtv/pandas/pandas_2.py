import matplotlib.pyplot as plt
import pandas as pd
import io

csv = '''
ID,group,time,success
P1,control,18.6,1
P2,control,15.42,1
P3,control,25.55,0
P4,control,12.56,0
P5,control,8.67,1
P6,experiment,7.31,0
P7,experiment,9.66,0
P8,experiment,13.64,1
P9,experiment,14.92,1
P10,experiment,18.47,1
'''

# weird error for this line if there is nothing else after this line
b = pd.read_csv(io.StringIO(csv))

