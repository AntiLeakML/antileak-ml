

def __phi__(phi_0, phi_1):
    if phi_0:
        return phi_0
    return phi_1

def set_field_wrapper(base, attr, value):
    setattr(base, attr, value)
    return base

def set_index_wrapper(base, attr, value):
    setattr(base, attr, value)
    return base

def global_wrapper(x):
    return x
_var0 = global_wrapper(null)
_var1 = {}
_var2 = []
_var3 = ['import numpy as np\n', 'import pandas as pd']
_var4 = {'cell_type': 'code', 'execution_count': _var0, 'metadata': _var1, 'outputs': _var2, 'source': _var3}
_var5 = global_wrapper(null)
_var6 = {}
_var7 = []
_var8 = ['# A structured array\n', "my_array = np.ones(3, dtype=([('foo', int), ('bar', float)]))\n", '# Print the structured array\n', "print(my_array['foo'])\n"]
_var9 = {'cell_type': 'code', 'execution_count': _var5, 'metadata': _var6, 'outputs': _var7, 'source': _var8}
_var10 = global_wrapper(null)
_var11 = {}
_var12 = []
_var13 = ['# A record array\n', 'my_array2 = my_array.view(np.recarray)\n', '# Print the record array\n', 'print(my_array2.foo)']
_var14 = {'cell_type': 'code', 'execution_count': _var10, 'metadata': _var11, 'outputs': _var12, 'source': _var13}
_var15 = global_wrapper(null)
_var16 = {}
_var17 = []
_var18 = ['# Take a 2D array as input to your DataFrame \n', 'my_2darray = np.array([[1, 2, 3], [4, 5, 6]])\n', 'print(pd.DataFrame(my_2darray))']
_var19 = {'cell_type': 'code', 'execution_count': _var15, 'metadata': _var16, 'outputs': _var17, 'source': _var18}
_var20 = global_wrapper(null)
_var21 = {}
_var22 = []
_var23 = ['# Take a dictionary as input to your DataFrame \n', "my_dict = {1: ['1', '3'], 2: ['1', '2'], 3: ['2', '4']}\n", 'print(pd.DataFrame(my_dict))']
_var24 = {'cell_type': 'code', 'execution_count': _var20, 'metadata': _var21, 'outputs': _var22, 'source': _var23}
_var25 = global_wrapper(null)
_var26 = {}
_var27 = []
_var28 = ['# Take a DataFrame as input to your DataFrame \n', "my_df = pd.DataFrame(data=[4,5,6,7], index=range(0,4), columns=['A'])\n", 'print(pd.DataFrame(my_df))']
_var29 = {'cell_type': 'code', 'execution_count': _var25, 'metadata': _var26, 'outputs': _var27, 'source': _var28}
_var30 = global_wrapper(null)
_var31 = {}
_var32 = []
_var33 = ['# Take a Series as input to your DataFrame\n', 'my_series = pd.Series({"Belgium":"Brussels", "India":"New Delhi", "United Kingdom":"London", "United States":"Washington"})\n', 'print(pd.DataFrame(my_series))']
_var34 = {'cell_type': 'code', 'execution_count': _var30, 'metadata': _var31, 'outputs': _var32, 'source': _var33}
_var35 = [_var4, _var9, _var14, _var19, _var24, _var29, _var34]
_var36 = {'name': 'python'}
_var37 = {'language_info': _var36}
{'cells': _var35, 'metadata': _var37, 'nbformat': 4, 'nbformat_minor': 2}
