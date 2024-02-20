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


# sort the data frame by the value of the size column
# in descending order
dogs = dogs.sort_values(by='size', ascending=False, inplace=True)
