import pandas as pd
import io


csv = '''
breed,size,weight,height
Labrador Retriever,medium,67.5,23.0
German Shepherd,large,,24.0
Beagle,small,,14.0
Golden Retriever,medium,60.0,22.75
Yorkshire Terrier,small,5.5,
Bulldog,medium,45.0,
Boxer,medium,,23.25
Poodle,medium,,16.0
Dachshund,small,24.0,
Rottweiler,large,,24.5
'''
dogs = pd.read_csv(io.StringIO(csv))


def task():
    '''
    create a data frame that, for each size of dog,
    calculate the sum, average and std for height
    and weight, with no NaNs in the result data frame
    '''
    return dogs.groupby('size').agg(['sum', 'mean', 'std'])

task()
